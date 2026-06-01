import { NextResponse } from 'next/server'
import { BigQuery } from '@google-cloud/bigquery'

const bq = new BigQuery({ projectId: 'my-test-app-498101' })
const DS = 'my_app_db'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { action, rows } = body

    // ── upsert_orders ──────────────────────────────────────────────────────
    if (action === 'upsert_orders') {
      const table = bq.dataset(DS).table('orders')
      let inserted = 0, updated = 0, skipped = 0
      const CHUNK = 400

      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk    = rows.slice(i, i + CHUNK)
        const orderNos = chunk.map((r: any) => r.order_no).filter(Boolean)
        if (orderNos.length === 0) continue

        // Check existing orders
        const inList = orderNos.map((n: string) => `'${n.replace(/'/g, "\\'")}'`).join(',')
        const [existing] = await bq.query({
          query: `SELECT order_no FROM \`my-test-app-498101.${DS}.orders\` WHERE order_no IN (${inList})`,
        })
        const existingSet = new Set(existing.map((r: any) => r.order_no))

        const newRows    = chunk.filter((r: any) => !existingSet.has(r.order_no))
        const updateRows = chunk.filter((r: any) =>  existingSet.has(r.order_no))

        if (newRows.length > 0) {
          await table.insert(newRows)
          inserted += newRows.length
        }

        for (const r of updateRows) {
          try {
            await bq.query({
              query: `
                UPDATE \`my-test-app-498101.${DS}.orders\`
                SET product_code=@product_code, product_name=@product_name,
                    group_name=@group_name, lot_number=@lot_number,
                    delivery_date=@delivery_date, order_date=@order_date,
                    quantity=@quantity, unit_price=@unit_price, amount=@amount,
                    weight_g=@weight_g, mfg_lot_no=@mfg_lot_no,
                    status=@status, source_file=@source_file
                WHERE order_no=@order_no`,
              params: r,
            })
            updated++
          } catch { skipped++ }
        }
      }
      return NextResponse.json({ inserted, updated, skipped })
    }

    // ── cancel_orders ──────────────────────────────────────────────────────
    if (action === 'cancel_orders') {
      let cancelled = 0, notFound = 0
      for (const order_no of rows) {
        const [ex] = await bq.query({
          query: `SELECT order_no FROM \`my-test-app-498101.${DS}.orders\` WHERE order_no=@o LIMIT 1`,
          params: { o: order_no },
        })
        if (ex.length > 0) {
          await bq.query({
            query: `UPDATE \`my-test-app-498101.${DS}.orders\` SET status='cancelled' WHERE order_no=@o`,
            params: { o: order_no },
          })
          cancelled++
        } else { notFound++ }
      }
      return NextResponse.json({ cancelled, notFound })
    }

    // ── write_log ──────────────────────────────────────────────────────────
    if (action === 'write_log') {
      await bq.dataset(DS).table('upload_log').insert([{ id: `log_${Date.now()}`, ...rows }])
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}