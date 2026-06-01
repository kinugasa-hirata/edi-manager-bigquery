import { NextResponse } from 'next/server'
import { BigQuery } from '@google-cloud/bigquery'

const bq = new BigQuery({ projectId: 'my-test-app-498101', ...(process.env.GOOGLE_CREDENTIALS_JSON ? { credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON) } : {}) })
const DS = 'my_app_db'

export async function POST(req: Request) {
  try {
    const { action, rows } = await req.json()

    // ── upsert_products ──────────────────────────────────────────────────────
    if (action === 'upsert_products') {
      for (const row of rows) {
        const [ex] = await bq.query({
          query:  `SELECT product_code FROM \`my-test-app-498101.${DS}.product_master\` WHERE product_code=@c LIMIT 1`,
          params: { c: row.product_code },
        })
        if (ex.length > 0) {
          await bq.query({
            query:  `UPDATE \`my-test-app-498101.${DS}.product_master\`
                     SET group_name=@gn, sort_order=@so
                     WHERE product_code=@pc`,
            params: { gn: row.group_name, so: row.sort_order, pc: row.product_code },
          })
        } else {
          await bq.query({
            query:  `INSERT INTO \`my-test-app-498101.${DS}.product_master\`
                     (product_code, group_name, sort_order)
                     VALUES (@pc, @gn, @so)`,
            params: { pc: row.product_code, gn: row.group_name, so: row.sort_order },
          })
        }
      }
      return NextResponse.json({ ok: true, count: rows.length })
    }

    // ── update_weights ───────────────────────────────────────────────────────
    if (action === 'update_weights') {
      let count = 0
      for (const { product_code, weight_g } of rows) {
        try {
          await bq.query({
            query:  `UPDATE \`my-test-app-498101.${DS}.product_master\` SET weight_g=@w WHERE product_code=@c`,
            params: { w: weight_g, c: product_code },
          })
          count++
        } catch {}
      }
      return NextResponse.json({ ok: true, count })
    }

    // ── upsert_lots ──────────────────────────────────────────────────────────
    if (action === 'upsert_lots') {
      for (const row of rows) {
        const [ex] = await bq.query({
          query:  `SELECT lot_id FROM \`my-test-app-498101.${DS}.lot_definitions\` WHERE lot_id=@id LIMIT 1`,
          params: { id: row.lot_id },
        })
        if (ex.length > 0) {
          await bq.query({
            query:  `UPDATE \`my-test-app-498101.${DS}.lot_definitions\`
                     SET lot_label=@ll, start_from=@sf, end_at=@ea, sort_order=@so
                     WHERE lot_id=@id`,
            params: { ll: row.lot_label, sf: row.start_from, ea: row.end_at, so: row.sort_order, id: row.lot_id },
          })
        } else {
          await bq.query({
            query:  `INSERT INTO \`my-test-app-498101.${DS}.lot_definitions\`
                     (lot_id, lot_label, start_from, end_at, sort_order)
                     VALUES (@id, @ll, @sf, @ea, @so)`,
            params: { id: row.lot_id, ll: row.lot_label, sf: row.start_from, ea: row.end_at, so: row.sort_order },
          })
        }
      }
      return NextResponse.json({ ok: true, count: rows.length })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e: any) {
    console.error('[master POST]', e.message)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}