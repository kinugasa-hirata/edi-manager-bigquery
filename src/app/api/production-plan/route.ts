import { NextResponse } from 'next/server'
import { BigQuery } from '@google-cloud/bigquery'

const bq = new BigQuery({ projectId: 'my-test-app-498101', ...(process.env.GOOGLE_CREDENTIALS_JSON ? { credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON) } : {}) })
const DS  = 'my_app_db'
const TBL = `\`my-test-app-498101.${DS}.production_plan\``

export async function GET() {
  try {
    const [rows] = await bq.query({ query: `SELECT * FROM ${TBL} LIMIT 2000` })
    return NextResponse.json({ data: rows })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const { product_code, week_start_date, planned_quantity } = await req.json()

    // Check if row exists
    const [ex] = await bq.query({
      query:  `SELECT product_code FROM ${TBL} WHERE product_code=@pc AND week_start_date=@wk LIMIT 1`,
      params: { pc: product_code, wk: week_start_date },
    })

    if (ex.length > 0) {
      if (planned_quantity > 0) {
        await bq.query({
          query:  `UPDATE ${TBL} SET planned_quantity=@qty WHERE product_code=@pc AND week_start_date=@wk`,
          params: { qty: planned_quantity, pc: product_code, wk: week_start_date },
        })
      } else {
        await bq.query({
          query:  `DELETE FROM ${TBL} WHERE product_code=@pc AND week_start_date=@wk`,
          params: { pc: product_code, wk: week_start_date },
        })
      }
    } else if (planned_quantity > 0) {
      // Use INSERT INTO SQL instead of streaming insert
      await bq.query({
        query:  `INSERT INTO ${TBL} (product_code, week_start_date, planned_quantity) VALUES (@pc, @wk, @qty)`,
        params: { pc: product_code, wk: week_start_date, qty: planned_quantity },
      })
    }
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error('[production-plan POST]', e.message)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}