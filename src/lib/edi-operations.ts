import { query, insert, table } from '@/lib/bigquery'
import type { EdiRow } from '@/lib/edi-parser'

export interface ProductMaster {
  product_code: string
  group_name: string
  weight_g: number
  sort_order: number
}

export interface LotDefinition {
  lot_id: string
  lot_label: string
  start_from: string
  end_at: string
  sort_order: number
}

export async function fetchProductMaster(): Promise<ProductMaster[]> {
  return query<ProductMaster>(
    `SELECT * FROM ${table('product_master')} LIMIT 200`
  )
}

export async function fetchLotDefinitions(): Promise<LotDefinition[]> {
  return query<LotDefinition>(
    `SELECT * FROM ${table('lot_definitions')} ORDER BY sort_order ASC LIMIT 50`
  )
}

function toDateStr(val: string | Date): string {
  if (!val) return ''
  const iso = typeof val === 'string' ? val : val.toISOString()
  return iso.slice(0, 10)
}

function assignLot(deliveryDate: string, lots: LotDefinition[]): string {
  if (!deliveryDate) return ''
  const d = toDateStr(deliveryDate)
  if (!d) return ''
  for (const lot of lots) {
    const start = toDateStr(lot.start_from)
    const end   = toDateStr(lot.end_at)
    if (d >= start && d <= end) return lot.lot_id
  }
  return '範囲外'
}

// ── 0502 Normal ──────────────────────────────────────────────────────────────
export async function processNormalEdi(
  rows: EdiRow[],
  products: ProductMaster[],
  lots: LotDefinition[],
  sourceFile: string,
  onProgress?: (n: number) => void
): Promise<{ inserted: number, updated: number, skipped: number }> {
  const productMap = new Map(products.map(p => [p.product_code, p]))
  const cutoff = '2026-04-01'

  const validRows = rows.filter(r => {
    if (!r.order_no || !r.product_code) return false
    if (!productMap.has(r.product_code)) return false
    const d = toDateStr(r.delivery_date)
    return d >= cutoff
  })

  let inserted = 0, updated = 0, skipped = 0

  for (let i = 0; i < validRows.length; i++) {
    const r = validRows[i]
    const product = productMap.get(r.product_code)!
    const lotNumber = assignLot(r.delivery_date, lots)

    const data = {
      order_no:      r.order_no,
      product_code:  r.product_code,
      product_name:  r.product_name,
      group_name:    product.group_name,
      lot_number:    lotNumber,
      delivery_date: r.delivery_date ? new Date(r.delivery_date).toISOString() : null,
      order_date:    r.order_date || null,
      quantity:      r.quantity,
      unit_price:    r.unit_price,
      amount:        r.amount,
      weight_g:      product.weight_g ?? null,
      mfg_lot_no:    r.mfg_lot_no,
      status:        'active',
      source_file:   sourceFile,
    }

    // Check if order already exists
    const existing = await query(
      `SELECT order_no FROM ${table('orders')} WHERE order_no = @order_no LIMIT 1`,
      { order_no: r.order_no }
    )

    try {
      if (existing.length === 0) {
        await insert('orders', [data])
        inserted++
      } else {
        await query(
          `UPDATE ${table('orders')} SET
            product_code = @product_code, product_name = @product_name,
            group_name = @group_name, lot_number = @lot_number,
            delivery_date = @delivery_date, order_date = @order_date,
            quantity = @quantity, unit_price = @unit_price, amount = @amount,
            weight_g = @weight_g, mfg_lot_no = @mfg_lot_no,
            status = @status, source_file = @source_file
          WHERE order_no = @order_no`,
          data
        )
        updated++
      }
    } catch {
      skipped++
    }

    if (onProgress) onProgress(i + 1)
  }

  return { inserted, updated, skipped }
}

// ── 0504 Torikeshi (Cancel) ───────────────────────────────────────────────────
export async function processCancelEdi(
  rows: EdiRow[],
  onProgress?: (n: number) => void
): Promise<{ cancelled: number, notFound: number }> {
  let cancelled = 0, notFound = 0

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (!r.order_no) { if (onProgress) onProgress(i + 1); continue }

    const existing = await query(
      `SELECT order_no FROM ${table('orders')} WHERE order_no = @order_no LIMIT 1`,
      { order_no: r.order_no }
    )

    if (existing.length > 0) {
      await query(
        `UPDATE ${table('orders')} SET status = 'cancelled' WHERE order_no = @order_no`,
        { order_no: r.order_no }
      )
      cancelled++
    } else {
      notFound++
    }

    if (onProgress) onProgress(i + 1)
  }

  return { cancelled, notFound }
}

// ── 0503 Henkou (Change/Update) ───────────────────────────────────────────────
export async function processHenkouEdi(
  rows: EdiRow[],
  products: ProductMaster[],
  lots: LotDefinition[],
  sourceFile: string,
  onProgress?: (n: number) => void
): Promise<{ updated: number, inserted: number, skipped: number }> {
  const productMap = new Map(products.map(p => [p.product_code, p]))
  let updated = 0, inserted = 0, skipped = 0

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (!r.order_no) { if (onProgress) onProgress(i + 1); continue }

    const product = productMap.get(r.product_code)
    if (!product) { skipped++; if (onProgress) onProgress(i + 1); continue }

    const lotNumber = assignLot(r.delivery_date, lots)
    const data = {
      order_no:      r.order_no,
      product_code:  r.product_code,
      product_name:  r.product_name,
      group_name:    product.group_name,
      lot_number:    lotNumber,
      delivery_date: r.delivery_date ? new Date(r.delivery_date).toISOString() : null,
      order_date:    r.order_date || null,
      quantity:      r.quantity,
      unit_price:    r.unit_price,
      amount:        r.amount,
      weight_g:      product.weight_g ?? null,
      mfg_lot_no:    r.mfg_lot_no,
      status:        'active',
      source_file:   sourceFile,
    }

    const existing = await query(
      `SELECT order_no FROM ${table('orders')} WHERE order_no = @order_no LIMIT 1`,
      { order_no: r.order_no }
    )

    try {
      if (existing.length > 0) {
        await query(
          `UPDATE ${table('orders')} SET
            product_code = @product_code, product_name = @product_name,
            group_name = @group_name, lot_number = @lot_number,
            delivery_date = @delivery_date, order_date = @order_date,
            quantity = @quantity, unit_price = @unit_price, amount = @amount,
            weight_g = @weight_g, mfg_lot_no = @mfg_lot_no,
            status = @status, source_file = @source_file
          WHERE order_no = @order_no`,
          data
        )
        updated++
      } else {
        await insert('orders', [data])
        inserted++
      }
    } catch {
      skipped++
    }

    if (onProgress) onProgress(i + 1)
  }

  return { updated, inserted, skipped }
}

// ── Upload Log ────────────────────────────────────────────────────────────────
export async function writeUploadLog(data: {
  filename: string
  file_type: string
  issue_date?: string
  rows_total: number
  rows_inserted?: number
  rows_updated?: number
  rows_cancelled?: number
  rows_skipped?: number
  uploaded_by: string
  status: string
  error_message?: string
}) {
  await insert('upload_log', [data])
}