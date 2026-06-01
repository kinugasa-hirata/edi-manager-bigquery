import { NextResponse } from 'next/server'
import { BigQuery } from '@google-cloud/bigquery'

const bq = new BigQuery({ projectId: 'my-test-app-498101', ...(process.env.GOOGLE_CREDENTIALS_JSON ? { credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON) } : {}) })
const DS  = 'my_app_db'
const TBL = `\`my-test-app-498101.${DS}.orders\``

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { action, rows } = body

    // ── upsert_orders ────────────────────────────────────────────────────────
    if (action === 'upsert_orders') {
      let inserted = 0, updated = 0, skipped = 0
      const CHUNK = 100

      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk    = rows.slice(i, i + CHUNK)
        const orderNos = chunk.map((r: any) => `'${r.order_no}'`).join(',')

        const [existing] = await bq.query({
          query: `SELECT order_no FROM ${TBL} WHERE order_no IN (${orderNos})`,
        })
        const existingSet = new Set(existing.map((r: any) => r.order_no))

        for (const r of chunk) {
          try {
            if (!existingSet.has(r.order_no)) {
              // INSERT using SQL
              await bq.query({
                query: `INSERT INTO ${TBL}
                  (order_no, product_code, product_name, group_name, lot_number,
                   delivery_date, order_date, quantity, unit_price, amount,
                   weight_g, mfg_lot_no, status, source_file)
                  VALUES (@order_no, @product_code, @product_name, @group_name, @lot_number,
                   @delivery_date, @order_date, @quantity, @unit_price, @amount,
                   @weight_g, @mfg_lot_no, @status, @source_file)`,
                params: {
                  order_no:     r.order_no     ?? null,
                  product_code: r.product_code ?? null,
                  product_name: r.product_name ?? null,
                  group_name:   r.group_name   ?? null,
                  lot_number:   r.lot_number   ?? null,
                  delivery_date: r.delivery_date ?? null,
                  order_date:   r.order_date   ?? null,
                  quantity:     r.quantity     ?? null,
                  unit_price:   r.unit_price   ?? null,
                  amount:       r.amount       ?? null,
                  weight_g:     r.weight_g     ?? null,
                  mfg_lot_no:   r.mfg_lot_no   ?? null,
                  status:       r.status       ?? 'active',
                  source_file:  r.source_file  ?? null,
                },
              })
              inserted++
            } else {
              await bq.query({
                query: `UPDATE ${TBL} SET
                  product_code=@product_code, product_name=@product_name,
                  group_name=@group_name, lot_number=@lot_number,
                  delivery_date=@delivery_date, order_date=@order_date,
                  quantity=@quantity, unit_price=@unit_price, amount=@amount,
                  weight_g=@weight_g, mfg_lot_no=@mfg_lot_no,
                  status=@status, source_file=@source_file
                  WHERE order_no=@order_no`,
                params: {
                  order_no:     r.order_no     ?? null,
                  product_code: r.product_code ?? null,
                  product_name: r.product_name ?? null,
                  group_name:   r.group_name   ?? null,
                  lot_number:   r.lot_number   ?? null,
                  delivery_date: r.delivery_date ?? null,
                  order_date:   r.order_date   ?? null,
                  quantity:     r.quantity     ?? null,
                  unit_price:   r.unit_price   ?? null,
                  amount:       r.amount       ?? null,
                  weight_g:     r.weight_g     ?? null,
                  mfg_lot_no:   r.mfg_lot_no   ?? null,
                  status:       r.status       ?? 'active',
                  source_file:  r.source_file  ?? null,
                },
              })
              updated++
            }
          } catch { skipped++ }
        }
      }
      return NextResponse.json({ inserted, updated, skipped })
    }

    // ── cancel_orders ────────────────────────────────────────────────────────
    if (action === 'cancel_orders') {
      let cancelled = 0, notFound = 0
      for (const order_no of rows) {
        const [ex] = await bq.query({
          query:  `SELECT order_no FROM ${TBL} WHERE order_no=@o LIMIT 1`,
          params: { o: order_no },
        })
        if (ex.length > 0) {
          await bq.query({
            query:  `UPDATE ${TBL} SET status='cancelled' WHERE order_no=@o`,
            params: { o: order_no },
          })
          cancelled++
        } else { notFound++ }
      }
      return NextResponse.json({ cancelled, notFound })
    }

    // ── write_log ────────────────────────────────────────────────────────────
    if (action === 'write_log') {
      const r = rows
      await bq.query({
        query: `INSERT INTO \`my-test-app-498101.${DS}.upload_log\`
          (id, filename, file_type, rows_total, rows_inserted, rows_updated,
           rows_cancelled, rows_skipped, uploaded_by, status, error_message)
          VALUES (@id, @fn, @ft, @rt, @ri, @ru, @rc, @rs, @ub, @st, @em)`,
        params: {
          id: `log_${Date.now()}`,
          fn: r.filename        ?? null,
          ft: r.file_type       ?? null,
          rt: r.rows_total      ?? 0,
          ri: r.rows_inserted   ?? 0,
          ru: r.rows_updated    ?? 0,
          rc: r.rows_cancelled  ?? 0,
          rs: r.rows_skipped    ?? 0,
          ub: r.uploaded_by     ?? null,
          st: r.status          ?? null,
          em: r.error_message   ?? null,
        },
      })
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e: any) {
    console.error('[edi/upload POST]', e.message)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}