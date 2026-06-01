import { NextResponse } from 'next/server'
import { BigQuery } from '@google-cloud/bigquery'

const bigquery = new BigQuery({ projectId: 'my-test-app-498101' })
const DATASET = 'my_app_db'

export async function GET() {
  const [rows] = await bigquery.query(
    `SELECT * FROM \`my-test-app-498101.${DATASET}.lots\` ORDER BY sort_order LIMIT 100`
  )
  return NextResponse.json({ data: rows })
}