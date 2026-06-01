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
  const r = await fetch('/api/products')
  const d = await r.json()
  return d.data ?? []
}

export async function fetchLotDefinitions(): Promise<LotDefinition[]> {
  const r = await fetch('/api/lots')
  const d = await r.json()
  return d.data ?? []
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

// ── 0502 Normal ───────────────────────────────────────────────────────────────
export async function processNormalEdi(
  rows: EdiRow[],
  products: ProductMaster[],
  lots: LotDefinition[],
  sourceFile: string,
  onProgress?: (n: number) => void
): Promise<{ inserted: number; updated: number; skipped: number }> {
  const productMap = new Map(products.map(p => [p.product_code, p]))
  const cutoff     = '2026-04-01'

  const validRows = rows.filter(r => {
    if (!r.order_no || !r.product_code) return false
    if (!productMap.has(r.product_code)) return false
    return toDateStr(r.delivery_date) >= cutoff
  })

  const payload = validRows.map(r => {
    const product = productMap.get(r.product_code)!
    return {
      order_no:      r.order_no,
      product_code:  r.product_code,
      product_name:  r.product_name,
      group_name:    product.group_name,
      lot_number:    assignLot(r.delivery_date, lots),
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
  })

  if (onProgress) onProgress(validRows.length)

  const res  = await fetch('/api/edi/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'upsert_orders', rows: payload }),
  })
  const data = await res.json()
  return { inserted: data.inserted ?? 0, updated: data.updated ?? 0, skipped: data.skipped ?? 0 }
}

// ── 0504 Torikeshi ────────────────────────────────────────────────────────────
export async function processCancelEdi(
  rows: EdiRow[],
  onProgress?: (n: number) => void
): Promise<{ cancelled: number; notFound: number }> {
  const orderNos = rows.map(r => r.order_no).filter(Boolean)
  if (onProgress) onProgress(orderNos.length)

  const res  = await fetch('/api/edi/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'cancel_orders', rows: orderNos }),
  })
  const data = await res.json()
  return { cancelled: data.cancelled ?? 0, notFound: data.notFound ?? 0 }
}

// ── 0503 Henkou ───────────────────────────────────────────────────────────────
export async function processHenkouEdi(
  rows: EdiRow[],
  products: ProductMaster[],
  lots: LotDefinition[],
  sourceFile: string,
  onProgress?: (n: number) => void
): Promise<{ updated: number; inserted: number; skipped: number }> {
  const result = await processNormalEdi(rows, products, lots, sourceFile, onProgress)
  return { updated: result.updated, inserted: result.inserted, skipped: result.skipped }
}

// ── Upload Log ────────────────────────────────────────────────────────────────
export async function writeUploadLog(data: {
  filename: string; file_type: string; rows_total: number
  rows_inserted?: number; rows_updated?: number
  rows_cancelled?: number; rows_skipped?: number
  uploaded_by: string; status: string; error_message?: string
}) {
  await fetch('/api/edi/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'write_log', rows: data }),
  })
}