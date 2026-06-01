import { BigQuery } from '@google-cloud/bigquery'

const bigquery = new BigQuery({
  projectId: 'my-test-app-498101',
})

export const PROJECT = 'my-test-app-498101'
export const DATASET = 'my_app_db'

export function table(name: string) {
  return `\`${PROJECT}.${DATASET}.${name}\``
}

export async function query<T = any>(
  sql: string,
  params?: Record<string, any>
): Promise<T[]> {
  const options: any = { query: sql }
  if (params) {
    options.params = params
  }
  const [rows] = await bigquery.query(options)
  return rows as T[]
}

export async function insert(tableName: string, rows: Record<string, any>[]) {
  const bqTable = bigquery.dataset(DATASET).table(tableName)
  await bqTable.insert(rows)
}

export default bigquery