import { NextResponse } from 'next/server'
import { BigQuery } from '@google-cloud/bigquery'

const bq = new BigQuery({ projectId: 'my-test-app-498101' })
const DS = 'my_app_db'

export async function GET() {
  try {
    const [rows] = await bq.query({
      query: `SELECT * FROM \`my-test-app-498101.${DS}.product_master\` ORDER BY sort_order LIMIT 200`,
    })
    return NextResponse.json({ data: rows })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}