export interface EdiRow {
  order_no: string
  product_code: string
  product_name: string
  delivery_date: string
  order_date: string    // 注文年月日 — date client placed this specific order
  quantity: number
  unit_price: number
  amount: number
  mfg_lot_no: string
  info_type: string
}

export function detectFileType(infoType: string): 'normal' | 'henkou' | 'torikeshi' | null {
  if (infoType === '0502') return 'normal'
  if (infoType === '0503') return 'henkou'
  if (infoType === '0504') return 'torikeshi'
  return null
}

export async function parseEdiFile(file: File): Promise<{ rows: EdiRow[], fileType: string, issueDate: string }> {
  const buffer = await file.arrayBuffer()
  const decoder = new TextDecoder('shift-jis')
  const text = decoder.decode(buffer)
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '')

  if (lines.length < 2) throw new Error('ファイルが空です')

  const headers = lines[0].split('\t')
  const dataLines = lines.slice(1)

  const idx = (name: string) => headers.indexOf(name)

  const rows: EdiRow[] = []
  let fileType = 'normal'
  let latestIssueDate = ''   // データ作成日 — most recent date across all rows

  for (const line of dataLines) {
    const cols = line.split('\t')
    if (cols.length < 10) continue

    const infoType = cols[idx('情報区分コード')]?.trim() ?? ''
    const detectedType = detectFileType(infoType)
    if (detectedType) fileType = detectedType

    const deliveryRaw = cols[idx('納期')]?.trim() ?? ''
    const deliveryDate = deliveryRaw.replace(/\//g, '-')

    // データ作成日 = client issue date (per row — take the latest across all rows)
    const issueDateRaw = cols[idx('データ作成日')]?.trim() ?? ''
    const issueDate = issueDateRaw.replace(/\//g, '-')
    if (issueDate && issueDate > latestIssueDate) latestIssueDate = issueDate

    // 注文年月日 = client's order date for this specific order line
    const orderDateRaw = cols[idx('注文年月日')]?.trim() ?? ''
    const orderDate    = orderDateRaw.replace(/\//g, '-')

    rows.push({
      order_no:     cols[idx('注文番号')]?.trim()          ?? '',
      product_code: cols[idx('発注者品名コード')]?.trim()   ?? '',
      product_name: cols[idx('品名（品名仕様）')]?.trim()   ?? '',
      delivery_date: deliveryDate,
      order_date:   orderDate,
      quantity:     parseFloat(cols[idx('注文数量（受注数量）')] ?? '0') || 0,
      unit_price:   parseFloat(cols[idx('単価')] ?? '0')  || 0,
      amount:       parseFloat(cols[idx('注文金額（受注金額）')] ?? '0') || 0,
      mfg_lot_no:   cols[idx('製造番号')]?.trim()          ?? '',
      info_type:    infoType,
    })
  }

  return { rows, fileType, issueDate: latestIssueDate }
}