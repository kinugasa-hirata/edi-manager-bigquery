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
      const CHUNK = 200

      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk    = rows.slice(i, i + CHUNK)
        const orderNos = chunk.map((r: any) => `'${String(r.order_no).replace(/'/g, "\\'")}'`).join(',')

        // Check existing
        const [existing] = await bq.query({
          query: `SELECT order_no FROM ${TBL} WHERE order_no IN (${orderNos})`,
        })
        const existingSet = new Set(existing.map((r: any) => r.order_no))

        const newRows = chunk.filter((r: any) => !existingSet.has(r.order_no))
        const updateRows = chunk.filter((r: any) => existingSet.has(r.order_no))

        // INSERT new rows via streaming (fast)
        if (newRows.length > 0) {
          const insertData = newRows.map((r: any) => ({
            order_no:      r.order_no      ?? '',
            product_code:  r.product_code  ?? '',
            product_name:  r.product_name  ?? '',
            group_name:    r.group_name    ?? '',
            lot_number:    r.lot_number    ?? '',
            delivery_date: r.delivery_date ?? null,
            order_date:    r.order_date    ?? null,
            quantity:      r.quantity      ?? 0,
            unit_price:    r.unit_price    ?? 0,
            amount:        r.amount        ?? 0,
            weight_g:      r.weight_g      ?? 0,
            mfg_lot_no:    r.mfg_lot_no    ?? '',
            status:        r.status        ?? 'active',
            source_file:   r.source_file   ?? '',
          }))
          try {
            await bq.dataset(DS).table('orders').insert(insertData)
            inserted += newRows.length
          } catch (e: any) {
            // insertErrors may contain partial success
            if (e.name === 'PartialFailureError') {
              inserted += newRows.length - (e.errors?.length ?? 0)
              skipped  += e.errors?.length ?? 0
            } else {
              console.error('[insert error]', e.message)
              skipped += newRows.length
            }
          }
        }

        // UPDATE existing rows via SQL (one by one but fewer rows)
        for (const r of updateRows) {
          try {
            await bq.query({
              query: `UPDATE ${TBL} SET
                product_code=@pc, product_name=@pn, group_name=@gn,
                lot_number=@ln, delivery_date=@dd, order_date=@od,
                quantity=@qty, unit_price=@up, amount=@amt,
                weight_g=@wg, mfg_lot_no=@mfg, status=@st, source_file=@sf
                WHERE order_no=@ono`,
              params: {
                ono: r.order_no     ?? '',
                pc:  r.product_code ?? '',
                pn:  r.product_name ?? '',
                gn:  r.group_name   ?? '',
                ln:  r.lot_number   ?? '',
                dd:  r.delivery_date ?? '',
                od:  r.order_date   ?? '',
                qty: r.quantity     ?? 0,
                up:  r.unit_price   ?? 0,
                amt: r.amount       ?? 0,
                wg:  r.weight_g     ?? 0,
                mfg: r.mfg_lot_no   ?? '',
                st:  r.status       ?? 'active',
                sf:  r.source_file  ?? '',
              },
              types: {
                ono:'STRING',pc:'STRING',pn:'STRING',gn:'STRING',ln:'STRING',
                dd:'STRING',od:'STRING',qty:'INT64',up:'FLOAT64',amt:'FLOAT64',
                wg:'FLOAT64',mfg:'STRING',st:'STRING',sf:'STRING',
              },
            })
            updated++
          } catch { skipped++ }
        }
      }
      return NextResponse.json({ inserted, updated, skipped })
    }

    // ── cancel_orders ────────────────────────────────────────────────────────
    if (action === 'cancel_orders') {
      let cancelled = 0, notFound = 0
      // Process in bulk using IN clause
      const CHUNK = 200
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk    = rows.slice(i, i + CHUNK)
        const orderNos = chunk.map((o: string) => `'${o}'`).join(',')
        try {
          const [ex] = await bq.query({
            query: `SELECT order_no FROM ${TBL} WHERE order_no IN (${orderNos})`,
          })
          const foundSet = new Set(ex.map((r: any) => r.order_no))
          for (const o of chunk) {
            if (foundSet.has(o)) cancelled++
            else notFound++
          }
          if (foundSet.size > 0) {
            const inList = Array.from(foundSet).map(o => `'${o}'`).join(',')
            await bq.query({
              query: `UPDATE ${TBL} SET status='cancelled' WHERE order_no IN (${inList})`,
            })
          }
        } catch (e: any) {
          console.error('[cancel error]', e.message)
          notFound += chunk.length
        }
      }
      return NextResponse.json({ cancelled, notFound })
    }

    // ── write_log ────────────────────────────────────────────────────────────
    if (action === 'write_log') {
      const r = rows
      try {
        await bq.dataset(DS).table('upload_log').insert([{
          id:             `log_${Date.now()}`,
          filename:       r.filename       ?? '',
          file_type:      r.file_type      ?? '',
          rows_total:     r.rows_total     ?? 0,
          rows_inserted:  r.rows_inserted  ?? 0,
          rows_updated:   r.rows_updated   ?? 0,
          rows_cancelled: r.rows_cancelled ?? 0,
          rows_skipped:   r.rows_skipped   ?? 0,
          uploaded_by:    r.uploaded_by    ?? '',
          status:         r.status         ?? '',
        }])
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