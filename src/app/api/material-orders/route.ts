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

const bq = createClient()
const DS = 'my_app_db'

export async function GET() {
  try {
    // ORDER BY を外してシンプルにSELECT
    const [rows] = await bq.query({
      query: `SELECT * FROM \`my-test-app-498101.${DS}.material_orders\` LIMIT 500`,
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
    await bq.dataset(DS).table('material_orders').insert([{ id, ...body }])
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
      query:  `UPDATE \`my-test-app-498101.${DS}.material_orders\` SET ${setClauses} WHERE id = @id`,
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
      query:  `DELETE FROM \`my-test-app-498101.${DS}.material_orders\` WHERE id = @id`,
      params: { id },
    })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error('[material-orders DELETE]', e.message)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}