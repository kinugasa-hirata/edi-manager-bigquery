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

export async function POST(req: Request) {
  try {
    const { action, rows } = await req.json()

    // ── upsert_products ────────────────────────────────────────────────────
    if (action === 'upsert_products') {
      for (const row of rows) {
        const [ex] = await bq.query({
          query: `SELECT product_code FROM \`my-test-app-498101.${DS}.product_master\` WHERE product_code=@c LIMIT 1`,
          params: { c: row.product_code },
        })
        if (ex.length > 0) {
          await bq.query({
            query: `UPDATE \`my-test-app-498101.${DS}.product_master\`
                    SET group_name=@group_name, sort_order=@sort_order
                    WHERE product_code=@product_code`,
            params: { group_name: row.group_name, sort_order: row.sort_order, product_code: row.product_code },
          })
        } else {
          await bq.dataset(DS).table('product_master').insert([row])
        }
      }
      return NextResponse.json({ ok: true, count: rows.length })
    }

    // ── update_weights ─────────────────────────────────────────────────────
    if (action === 'update_weights') {
      let count = 0
      for (const { product_code, weight_g } of rows) {
        try {
          await bq.query({
            query: `UPDATE \`my-test-app-498101.${DS}.product_master\` SET weight_g=@w WHERE product_code=@c`,
            params: { w: weight_g, c: product_code },
          })
          count++
        } catch {}
      }
      return NextResponse.json({ ok: true, count })
    }

    // ── upsert_lots ────────────────────────────────────────────────────────
    if (action === 'upsert_lots') {
      for (const row of rows) {
        const [ex] = await bq.query({
          query: `SELECT lot_id FROM \`my-test-app-498101.${DS}.lot_definitions\` WHERE lot_id=@id LIMIT 1`,
          params: { id: row.lot_id },
        })
        if (ex.length > 0) {
          await bq.query({
            query: `UPDATE \`my-test-app-498101.${DS}.lot_definitions\`
                    SET lot_label=@lot_label, start_from=@start_from, end_at=@end_at, sort_order=@sort_order
                    WHERE lot_id=@lot_id`,
            params: { lot_label: row.lot_label, start_from: row.start_from, end_at: row.end_at, sort_order: row.sort_order, lot_id: row.lot_id },
          })
        } else {
          await bq.dataset(DS).table('lot_definitions').insert([row])
        }
      }
      return NextResponse.json({ ok: true, count: rows.length })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}