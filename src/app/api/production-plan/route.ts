import { NextResponse } from 'next/server'
import { BigQuery } from '@google-cloud/bigquery'

const bq = new BigQuery({ projectId: 'my-test-app-498101' })
const DS = 'my_app_db'

export async function GET() {
  try {
    const [rows] = await bq.query({
      query: `SELECT * FROM \`my-test-app-498101.${DS}.production_plan\` LIMIT 2000`,
    })
    return NextResponse.json({ data: rows })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const { product_code, week_start_date, planned_quantity } = await req.json()
    // DELETE existing row for this product+week, then INSERT if qty > 0
    await bq.query({
      query:  `DELETE FROM \`my-test-app-498101.${DS}.production_plan\` WHERE product_code=@pc AND week_start_date=@wk`,
      params: { pc: product_code, wk: week_start_date },
    })
    if (planned_quantity > 0) {
      await bq.dataset(DS).table('production_plan').insert([{ product_code, week_start_date, planned_quantity }])
    }
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}