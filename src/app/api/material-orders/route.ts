import { NextResponse } from 'next/server'
import { BigQuery } from '@google-cloud/bigquery'

const bq = new BigQuery({ projectId: 'my-test-app-498101' })
const DS = 'my_app_db'

export async function GET() {
  try {
    const [rows] = await bq.query({
      query: `SELECT * FROM \`my-test-app-498101.${DS}.material_orders\` ORDER BY delivery_date LIMIT 500`,
    })
    return NextResponse.json({ data: rows })
  } catch (e: any) {
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
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}