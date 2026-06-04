import { NextResponse } from 'next/server'
import { BigQuery } from '@google-cloud/bigquery'

const bq = new BigQuery({
  projectId: 'my-test-app-498101',
  ...(process.env.GOOGLE_CREDENTIALS_JSON
    ? { credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON) }
    : {}),
})
const DS  = 'my_app_db'
const TBL = '`my-test-app-498101.my_app_db.orders`'

// ── helpers ──────────────────────────────────────────────────────────────────

function esc(v: unknown): string {
  return String(v ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function dateOrNull(v: unknown): string {
  if (!v) return 'NULL'
  const s = String(v).slice(0, 10)
  return s.length === 10 ? `TIMESTAMP '${s} 00:00:00'` : 'NULL'
}

// ── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { action, rows } = body

    // ── upsert_orders ────────────────────────────────────────────────────────
    if (action === 'upsert_orders') {
      if (!rows || rows.length === 0)
        return NextResponse.json({ inserted: 0, updated: 0, skipped: 0 })

      const unionRows = (rows as any[]).map((r) => {
        return [
          `SELECT`,
          `  '${esc(r.order_no)}'     AS order_no,`,
          `  '${esc(r.product_code)}' AS product_code,`,
          `  '${esc(r.product_name)}' AS product_name,`,
          `  '${esc(r.group_name)}'   AS group_name,`,
          `  '${esc(r.lot_number)}'   AS lot_number,`,
          `  ${dateOrNull(r.delivery_date)} AS delivery_date,`,
          `  ${dateOrNull(r.order_date)}    AS order_date,`,
          `  ${Number(r.quantity   ?? 0)} AS quantity,`,
          `  ${Number(r.unit_price ?? 0)} AS unit_price,`,
          `  ${Number(r.amount     ?? 0)} AS amount,`,
          `  ${Number(r.weight_g   ?? 0)} AS weight_g,`,
          `  '${esc(r.mfg_lot_no)}'  AS mfg_lot_no,`,
          `  '${esc(r.status ?? 'active')}' AS status,`,
          `  '${esc(r.source_file)}' AS source_file`,
        ].join('\n')
      }).join('\nUNION ALL\n')

      const mergeSQL = `
        MERGE ${TBL} AS T
        USING (${unionRows}) AS S
        ON T.order_no = S.order_no
        WHEN MATCHED THEN UPDATE SET
          T.product_code  = S.product_code,
          T.product_name  = S.product_name,
          T.group_name    = S.group_name,
          T.lot_number    = S.lot_number,
          T.delivery_date = S.delivery_date,
          T.order_date    = S.order_date,
          T.quantity      = S.quantity,
          T.unit_price    = S.unit_price,
          T.amount        = S.amount,
          T.weight_g      = S.weight_g,
          T.mfg_lot_no    = S.mfg_lot_no,
          T.status        = S.status,
          T.source_file   = S.source_file
        WHEN NOT MATCHED THEN INSERT
          (order_no, product_code, product_name, group_name, lot_number,
           delivery_date, order_date, quantity, unit_price, amount,
           weight_g, mfg_lot_no, status, source_file)
        VALUES
          (S.order_no, S.product_code, S.product_name, S.group_name, S.lot_number,
           S.delivery_date, S.order_date, S.quantity, S.unit_price, S.amount,
           S.weight_g, S.mfg_lot_no, S.status, S.source_file)
      `

      try {
        const [job]  = await bq.createQueryJob({ query: mergeSQL })
        await job.getQueryResults()
        const qStats = (job as any).metadata?.statistics?.query
        const inserted = Number(qStats?.numDmlAffectedRows ?? 0)
        return NextResponse.json({ inserted, updated: 0, skipped: 0 })
      } catch (e: any) {
        console.error('[merge error]', e.message)
        return NextResponse.json({ inserted: 0, updated: 0, skipped: rows.length })
      }
    }

    // ── cancel_orders ────────────────────────────────────────────────────────
    if (action === 'cancel_orders') {
      if (!rows || rows.length === 0)
        return NextResponse.json({ cancelled: 0, notFound: 0 })

      const inList = (rows as string[]).map(o => `'${esc(o)}'`).join(',')

      try {
        const [[{ cnt }]] = await bq.query({
          query: `SELECT COUNT(*) AS cnt FROM ${TBL}
                  WHERE order_no IN (${inList}) AND status != 'cancelled'`,
        })
        const found = Number(cnt ?? 0)

        await bq.query({
          query: `UPDATE ${TBL} SET status='cancelled' WHERE order_no IN (${inList})`,
        })

        return NextResponse.json({ cancelled: found, notFound: rows.length - found })
      } catch (e: any) {
        console.error('[cancel error]', e.message)
        return NextResponse.json({ cancelled: 0, notFound: rows.length })
      }
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