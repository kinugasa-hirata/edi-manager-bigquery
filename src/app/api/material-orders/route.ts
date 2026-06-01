import { NextResponse } from 'next/server'
import { BigQuery } from '@google-cloud/bigquery'

function createClient() {
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    return new BigQuery({
      projectId: 'my-test-app-498101',
      credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON),
    })
  }
  return new BigQuery({ projectId: 'my-test-app-498101' })
}

const bq = new BigQuery({ projectId: 'my-test-app-498101', ...(process.env.GOOGLE_CREDENTIALS_JSON ? { credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON) } : {}) })
const DS = 'my_app_db'
const TBL = `\`my-test-app-498101.${DS}.material_orders\``

export async function GET() {
  try {
    const [rows] = await bq.query({
      query: `SELECT * FROM ${TBL} ORDER BY delivery_date LIMIT 500`,
    })
    return NextResponse.json({ data: rows })
  } catch (e: any) {
    console.error('[material-orders GET]', e.message)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const id   = `mo_${Date.now()}`
    const { material_name, quantity_kg, delivery_date, order_date, status, note, trading_company } = body
    await bq.query({
      query: `INSERT INTO ${TBL}
        (id, material_name, quantity_kg, delivery_date, order_date, status, note, trading_company)
        VALUES (@id, @mn, @qkg, @dd, @od, @st, @nt, @tc)`,
      params: {
        id,
        mn:  material_name   ?? null,
        qkg: quantity_kg     ?? null,
        dd:  delivery_date   ?? null,
        od:  order_date      ?? null,
        st:  status          ?? null,
        nt:  note            ?? null,
        tc:  trading_company ?? null,
      },
    })
    return NextResponse.json({ ok: true, id })
  } catch (e: any) {
    console.error('[material-orders POST]', e.message)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  try {
    const { id, ...fields } = await req.json()
    const keys       = Object.keys(fields)
    const setClauses = keys.map(k => `${k} = @${k}`).join(', ')
    await bq.query({
      query:  `UPDATE ${TBL} SET ${setClauses} WHERE id = @id`,
      params: { id, ...fields },
    })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error('[material-orders PATCH]', e.message)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const { id } = await req.json()
    await bq.query({
      query:  `DELETE FROM ${TBL} WHERE id = @id`,
      params: { id },
    })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error('[material-orders DELETE]', e.message)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}