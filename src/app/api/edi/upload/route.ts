import { NextResponse } from 'next/server'
import { BigQuery } from '@google-cloud/bigquery'

const bq = new BigQuery({ projectId: 'my-test-app-498101', ...(process.env.GOOGLE_CREDENTIALS_JSON ? { credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON) } : {}) })
const DS  = 'my_app_db'
const TBL = `\`my-test-app-498101.${DS}.orders\``

// Helper: nullを含むパラメータに型情報を付与
function makeParams(r: any) {
  return {
    order_no:      r.order_no     ?? '',
    product_code:  r.product_code ?? '',
    product_name:  r.product_name ?? '',
    group_name:    r.group_name   ?? '',
    lot_number:    r.lot_number   ?? '',
    delivery_date: r.delivery_date ?? '',
    order_date:    r.order_date   ?? '',
    quantity:      r.quantity     ?? 0,
    unit_price:    r.unit_price   ?? 0,
    amount:        r.amount       ?? 0,
    weight_g:      r.weight_g     ?? 0,
    mfg_lot_no:    r.mfg_lot_no   ?? '',
    status:        r.status       ?? 'active',
    source_file:   r.source_file  ?? '',
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { action, rows } = body

    // ── upsert_orders ────────────────────────────────────────────────────────
    if (action === 'upsert_orders') {
      let inserted = 0, updated = 0, skipped = 0
      const CHUNK = 50

      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk    = rows.slice(i, i + CHUNK)
        const orderNos = chunk.map((r: any) => `'${r.order_no}'`).join(',')

        const [existing] = await bq.query({
          query: `SELECT order_no FROM ${TBL} WHERE order_no IN (${orderNos})`,
        })
        const existingSet = new Set(existing.map((r: any) => r.order_no))

        for (const r of chunk) {
          const p = makeParams(r)
          try {
            if (!existingSet.has(r.order_no)) {
              await bq.query({
                query: `INSERT INTO ${TBL}
                  (order_no, product_code, product_name, group_name, lot_number,
                   delivery_date, order_date, quantity, unit_price, amount,
                   weight_g, mfg_lot_no, status, source_file)
                  VALUES (@order_no, @product_code, @product_name, @group_name, @lot_number,
                   @delivery_date, @order_date, @quantity, @unit_price, @amount,
                   @weight_g, @mfg_lot_no, @status, @source_file)`,
                params: p,
                types: {
                  order_no: 'STRING', product_code: 'STRING', product_name: 'STRING',
                  group_name: 'STRING', lot_number: 'STRING', delivery_date: 'STRING',
                  order_date: 'STRING', quantity: 'INT64', unit_price: 'FLOAT64',
                  amount: 'FLOAT64', weight_g: 'FLOAT64', mfg_lot_no: 'STRING',
                  status: 'STRING', source_file: 'STRING',
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
                params: p,
                types: {
                  order_no: 'STRING', product_code: 'STRING', product_name: 'STRING',
                  group_name: 'STRING', lot_number: 'STRING', delivery_date: 'STRING',
                  order_date: 'STRING', quantity: 'INT64', unit_price: 'FLOAT64',
                  amount: 'FLOAT64', weight_g: 'FLOAT64', mfg_lot_no: 'STRING',
                  status: 'STRING', source_file: 'STRING',
                },
              })
              updated++
            }
          } catch (e: any) {
            console.error('[edi/upload row error]', e.message, r.order_no)
            skipped++
          }
        }
      }
      return NextResponse.json({ inserted, updated, skipped })
    }

    // ── cancel_orders ────────────────────────────────────────────────────────
    if (action === 'cancel_orders') {
      let cancelled = 0, notFound = 0
      for (const order_no of rows) {
        try {
          const [ex] = await bq.query({
            query:  `SELECT order_no FROM ${TBL} WHERE order_no=@o LIMIT 1`,
            params: { o: order_no },
            types:  { o: 'STRING' },
          })
          if (ex.length > 0) {
            await bq.query({
              query:  `UPDATE ${TBL} SET status='cancelled' WHERE order_no=@o`,
              params: { o: order_no },
              types:  { o: 'STRING' },
            })
            cancelled++
          } else { notFound++ }
        } catch (e: any) {
          console.error('[cancel error]', e.message)
          notFound++
        }
      }
      return NextResponse.json({ cancelled, notFound })
    }

    // ── write_log ────────────────────────────────────────────────────────────
    if (action === 'write_log') {
      const r = rows
      try {
        await bq.query({
          query: `INSERT INTO \`my-test-app-498101.${DS}.upload_log\`
            (id, filename, file_type, rows_total, rows_inserted, rows_updated,
             rows_cancelled, rows_skipped, uploaded_by, status)
            VALUES (@id, @fn, @ft, @rt, @ri, @ru, @rc, @rs, @ub, @st)`,
          params: {
            id: `log_${Date.now()}`,
            fn: r.filename      ?? '',
            ft: r.file_type     ?? '',
            rt: r.rows_total    ?? 0,
            ri: r.rows_inserted ?? 0,
            ru: r.rows_updated  ?? 0,
            rc: r.rows_cancelled ?? 0,
            rs: r.rows_skipped  ?? 0,
            ub: r.uploaded_by   ?? '',
            st: r.status        ?? '',
          },
          types: {
            id: 'STRING', fn: 'STRING', ft: 'STRING',
            rt: 'INT64', ri: 'INT64', ru: 'INT64', rc: 'INT64', rs: 'INT64',
            ub: 'STRING', st: 'STRING',
          },
        })
      } catch (e: any) {
        console.error('[write_log error]', e.message)
      }
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e: any) {
    console.error('[edi/upload POST]', e.message)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}