import { BigQuery } from '@google-cloud/bigquery'

function createBigQueryClient() {
  // Vercel環境: 環境変数からサービスアカウントJSONを読み込む
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON)
    return new BigQuery({ projectId: 'my-test-app-498101', credentials })
  }
  // ローカル環境: gcloud auth application-default login を使用
  return new BigQuery({ projectId: 'my-test-app-498101' })
}

const bigquery = createBigQueryClient()

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
  if (params) options.params = params
  const [rows] = await bigquery.query(options)
  return rows as T[]
}

export async function insert(tableName: string, rows: Record<string, any>[]) {
  await bigquery.dataset(DATASET).table(tableName).insert(rows)
}

export default bigquery