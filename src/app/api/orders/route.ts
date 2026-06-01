import { NextResponse } from 'next/server'
import { BigQuery } from '@google-cloud/bigquery'

const bq = new BigQuery({ projectId: 'my-test-app-498101' })
const DS = 'my_app_db'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')
    const where  = status ? `WHERE status = '${status}'` : ''
    const [rows] = await bq.query({
      query: `SELECT * FROM \`my-test-app-498101.${DS}.orders\` ${where} ORDER BY delivery_date LIMIT 5000`,
    })
    return NextResponse.json({ data: rows })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}