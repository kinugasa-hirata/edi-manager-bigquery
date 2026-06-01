'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
import * as XLSX from 'xlsx'
import { useStock } from '@/lib/stock-context'

// ── Types ─────────────────────────────────────────────────────────────────────
interface Order {
  id: string
  order_no: string
  product_code: string
  product_name: string
  group_name: string
  lot_number: string
  mfg_lot_no: string
  delivery_date: string
  order_date: string
  quantity: number
  weight_g: number | null
  status: string
}

interface ProductMaster {
  id: string
  product_code: string
  group_name: string
  weight_g: number | null
  sort_order: number
  initial_stock: number | null
}

interface MaterialOrder {
  id: string
  material_name: string
  quantity_kg: number
  delivery_date: string
  status: string
  trading_company: string | null
}

interface ProductionPlan {
  id: string
  product_code: string
  week_start_date: string
  planned_quantity: number
}

// ── Constants ─────────────────────────────────────────────────────────────────
const GROUP_ORDER = ['M90S', '300NP', '100G20', '950X01']

const LOT_LABELS: Record<string, string> = {
  '1': '4／初〜', '2': '4／末〜', '3': '5／末〜', '4': '6／中〜',
  '5': '7／末〜', '6': '9／初〜', '7': '10／初〜', '8': '11／初〜',
  '9': '11／中〜', '10': '12／中〜', '国①': '1／中〜', '国②': '2／初〜',
}

const GROUP_LIST = ['M90S', '300NP', '100G20', '950X01'] as const

const GROUP_COLORS: Record<string, string> = {
  'M90S':   'bg-blue-50 text-blue-700 border-blue-200',
  '300NP':  'bg-green-50 text-green-700 border-green-200',
  '100G20': 'bg-red-50 text-red-700 border-red-200',
  '950X01': 'bg-purple-50 text-purple-700 border-purple-200',
}


// ── BigQuery date helper ───────────────────────────────────────────────────
// BigQuery returns TIMESTAMP/DATE as objects or ISO strings with timezone.
// This normalizes any format to a plain "YYYY-MM-DD" string.
function toDateStr(val: any): string {
  if (!val) return ''
  if (typeof val === 'string') return val.slice(0, 10)
  if (val instanceof Date) {
    const y = val.getUTCFullYear()
    const m = String(val.getUTCMonth() + 1).padStart(2, '0')
    const d = String(val.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  // BigQuery BigQueryDate / BigQueryTimestamp object
  if (val.value) return String(val.value).slice(0, 10)
  return String(val).slice(0, 10)
}

function SortIcon({ state }: { state: 'asc' | 'desc' | null }) {
  if (!state) return <span className="ml-1 text-gray-300 text-[10px]">↕</span>
  return <span className="ml-1 text-blue-500 text-[10px]">{state === 'asc' ? '↑' : '↓'}</span>
}

export default function OrdersPage() {
  const [orders,         setOrders]         = useState<Order[]>([])
  const [products,       setProducts]       = useState<ProductMaster[]>([])
  const [plans,          setPlans]          = useState<ProductionPlan[]>([])
  const [materialOrders, setMaterialOrders] = useState<MaterialOrder[]>([])
  const [loading,        setLoading]        = useState(true)
  const [statusFilter,   setStatusFilter]   = useState<'active' | 'cancelled' | 'all'>('active')
  const [groupFilter,    setGroupFilter]    = useState('')
  const [lotFilter,      setLotFilter]      = useState('')
  const [search,         setSearch]         = useState('')
  const [sortKey,        setSortKey]        = useState<string>('delivery_date')
  const [sortDir,        setSortDir]        = useState<'asc' | 'desc'>('asc')
  const [page,           setPage]           = useState(0)
  const PAGE_SIZE = 100

  const [showExport,     setShowExport]     = useState(false)
  const [selGroups,      setSelGroups]      = useState<Set<string>>(new Set())
  const [selMfg,         setSelMfg]         = useState<Set<string>>(new Set())
  const [splitByProduct, setSplitByProduct] = useState(false)

  const { dailyStock } = useStock()
  const answerFileRef  = useRef<HTMLInputElement>(null)

  async function fetchOrders() {
    setLoading(true)
    try {
      const [oRes, pRes, plRes, mRes] = await Promise.all([
        fetch('/api/orders').then(r => r.json()),
        fetch('/api/products').then(r => r.json()),
        fetch('/api/production-plan').then(r => r.json()),
        fetch('/api/material-orders').then(r => r.json()),
      ])
      setOrders(oRes.data ?? [])
      setProducts(pRes.data ?? [])
      setPlans(plRes.data ?? [])
      setMaterialOrders(mRes.data ?? [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchOrders() }, [])

  // ── 回答納期チェック ────────────────────────────────────────────────────────
  async function handleAnswerCheck(file: File) {
    const buf = await file.arrayBuffer()
    const wb  = XLSX.read(buf, { type: 'array', cellDates: true })
    const ws  = wb.Sheets[wb.SheetNames[0]]
    const aoa = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: false })
    const OUR_PATTERN = /^\d+PP\d+-\d+[PG]\d+/
    const productMap  = new Map<string, ProductMaster>()
    for (const p of products) productMap.set(p.product_code, p)

    function getStock(productCode: string): number {
      const pm = productMap.get(productCode)
      if (!pm || pm.initial_stock === null) return 0
      if (dailyStock) {
        const pDailyMap = dailyStock.byProduct.get(productCode)
        if (pDailyMap && pDailyMap.size > 0) {
          const sortedDates = Array.from(pDailyMap.keys()).sort()
          const lastStock   = pDailyMap.get(sortedDates[sortedDates.length - 1]) ?? pm.initial_stock
          const totalAll    = orders
            .filter(o => o.product_code === productCode && o.status === 'active')
            .reduce((s, o) => s + (o.quantity ?? 0), 0)
          return Math.max(pm.initial_stock, lastStock + totalAll)
        }
      }
      return pm.initial_stock
    }

    const orderResultMap = new Map<string, 'OK' | 'NG'>()
    const byProduct      = new Map<string, Order[]>()
    for (const o of orders) {
      if (o.status !== 'active') continue
      if (!byProduct.has(o.product_code)) byProduct.set(o.product_code, [])
      byProduct.get(o.product_code)!.push(o)
    }
    for (const [pc, pOrders] of byProduct) {
      const sorted  = [...pOrders].sort((a, b) =>
        toDateStr(a.delivery_date).localeCompare(toDateStr(b.delivery_date)))
      let running   = getStock(pc)
      for (const o of sorted) {
        running -= (o.quantity ?? 0)
        orderResultMap.set(o.order_no, running >= 0 ? 'OK' : 'NG')
      }
    }

    const header      = aoa[0] as any[]
    const orderNoIdx  = header.findIndex((h: any) => String(h ?? '').includes('注文番号')) ?? 3
    const prodCodeIdx = header.findIndex((h: any) => String(h ?? '').includes('品目'))    ?? 4
    const answerIdx   = 14
    let matched = 0, skipped = 0, okCount = 0, ngCount = 0

    for (let i = 1; i < aoa.length; i++) {
      const row      = aoa[i] as any[]
      const orderNo  = String(row[orderNoIdx] ?? '').trim()
      const rawCode  = String(row[prodCodeIdx] ?? '').trim()
      const prodCode = rawCode.startsWith('=>') ? rawCode.slice(2).trim() : rawCode
      if (!orderNo || !OUR_PATTERN.test(prodCode)) { skipped++; continue }
      let answer = orderResultMap.get(orderNo)
      if (answer === undefined) {
        for (const suffix of ['001', '002', '003', '004', '005']) {
          const candidate = orderResultMap.get(orderNo + suffix)
          if (candidate !== undefined) { answer = candidate; break }
        }
      }
      while (row.length <= answerIdx) row.push('')
      if (answer !== undefined) {
        row[answerIdx] = answer
        answer === 'OK' ? okCount++ : ngCount++
        matched++
      } else {
        row[answerIdx] = ''
        skipped++
      }
    }

    const outWs = XLSX.utils.aoa_to_sheet(aoa)
    const outWb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(outWb, outWs, wb.SheetNames[0])
    const date = new Date().toISOString().slice(0, 10)
    XLSX.writeFile(outWb, `回答納期チェック_${date}.xlsx`)
    alert(`完了\nチェック: ${matched}件 (OK: ${okCount} / NG: ${ngCount})\n対象外スキップ: ${skipped}件`)
  }

  // ── Table filtering + sorting ─────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = orders
    if (statusFilter !== 'all') list = list.filter(o => o.status === (statusFilter === 'active' ? 'active' : 'cancelled'))
    if (groupFilter) list = list.filter(o => o.group_name === groupFilter)
    if (lotFilter)   list = list.filter(o => o.lot_number  === lotFilter)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(o =>
        o.order_no?.toLowerCase().includes(q) ||
        o.product_code?.toLowerCase().includes(q) ||
        o.product_name?.toLowerCase().includes(q) ||
        o.mfg_lot_no?.toLowerCase().includes(q)
      )
    }
    return [...list].sort((a, b) => {
      let va: any = sortKey === 'delivery_date' ? toDateStr((a as any)[sortKey]) : ((a as any)[sortKey] ?? '')
      let vb: any = sortKey === 'delivery_date' ? toDateStr((b as any)[sortKey]) : ((b as any)[sortKey] ?? '')
      if (sortKey === 'quantity') { va = Number(va); vb = Number(vb) }
      const cmp = va < vb ? -1 : va > vb ? 1 : 0
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [orders, statusFilter, groupFilter, lotFilter, search, sortKey, sortDir])

  const paged      = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)

  function handleSort(key: string) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
    setPage(0)
  }

  // ── Export helpers ────────────────────────────────────────────────────────
  const mfgOptions = useMemo(() => {
    const nums = Array.from(
      new Set(orders.filter(o => o.status === 'active').map(o => o.mfg_lot_no).filter(Boolean))
    )
    const earliestDate = new Map<string, string>()
    for (const o of orders) {
      if (!o.mfg_lot_no || !o.delivery_date) continue
      const d   = toDateStr(o.delivery_date)
      const cur = earliestDate.get(o.mfg_lot_no)
      if (!cur || d < cur) earliestDate.set(o.mfg_lot_no, d)
    }
    return nums.sort((a, b) =>
      (earliestDate.get(a) ?? a).localeCompare(earliestDate.get(b) ?? b))
  }, [orders])

  useEffect(() => { setSelMfg(new Set(mfgOptions)) }, [mfgOptions])

  const exportOrders = useMemo(() => {
    if (selGroups.size === 0) return []
    return orders.filter(o => {
      if (o.status !== 'active') return false
      if (!selGroups.has(o.group_name)) return false
      if (selMfg.size > 0 && o.mfg_lot_no && !selMfg.has(o.mfg_lot_no)) return false
      return true
    })
  }, [orders, selGroups, selMfg])

  function toggleGroup(g: string) {
    setSelGroups(prev => { const n = new Set(prev); n.has(g) ? n.delete(g) : n.add(g); return n })
  }
  function toggleMfg(m: string) {
    setSelMfg(prev => { const n = new Set(prev); n.has(m) ? n.delete(m) : n.add(m); return n })
  }

  const mfgLotSortOrder = useMemo(() => {
    const earliest = new Map<string, string>()
    for (const o of orders) {
      if (!o.mfg_lot_no || !o.delivery_date) continue
      const d   = toDateStr(o.delivery_date)
      const cur = earliest.get(o.mfg_lot_no)
      if (!cur || d < cur) earliest.set(o.mfg_lot_no, d)
    }
    return earliest
  }, [orders])

  function handleExport(format: 'csv' | 'excel') {
    const sorted = [...exportOrders].sort((a, b) => {
      const dateA = toDateStr(a.delivery_date)
      const dateB = toDateStr(b.delivery_date)
      if (dateA !== dateB) return dateA.localeCompare(dateB)
      const mfgA = mfgLotSortOrder.get(a.mfg_lot_no) ?? a.mfg_lot_no ?? ''
      const mfgB = mfgLotSortOrder.get(b.mfg_lot_no) ?? b.mfg_lot_no ?? ''
      return mfgA.localeCompare(mfgB)
    })

    const headers = ['注文番号', '品番', '品名', 'グループ', 'LOT', '納期', '数量', '重量(g)', '製造番号']
    const date    = new Date().toISOString().slice(0, 10)
    const productMap = new Map<string, ProductMaster>()
    for (const p of products) productMap.set(p.product_code, p)

    if (format === 'csv') {
      const rows = sorted.map(o => {
        const deliveryStr = toDateStr(o.delivery_date)
        return [
          o.order_no, o.product_code, o.product_name, o.group_name,
          o.lot_number ? `${o.lot_number} (${LOT_LABELS[o.lot_number] ?? ''})` : '',
          deliveryStr.replace(/-/g, '/'), o.quantity, o.weight_g ?? '', o.mfg_lot_no ?? '',
        ]
      })
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, '注文一覧')
      XLSX.writeFile(wb, `注文一覧_${date}.csv`, { bookType: 'csv' })
      setShowExport(false)
      return
    }

    function getStartingStock(productCode: string): number | null {
      const pm = productMap.get(productCode)
      if (!pm || pm.initial_stock === null) return null
      if (dailyStock) {
        const pDailyMap = dailyStock.byProduct.get(productCode)
        if (pDailyMap && pDailyMap.size > 0) {
          const sortedDates    = Array.from(pDailyMap.keys()).sort()
          const lastStock      = pDailyMap.get(sortedDates[sortedDates.length - 1]) ?? pm.initial_stock
          const totalAllOrders = orders
            .filter(o => o.product_code === productCode && o.status === 'active')
            .reduce((s, o) => s + (o.quantity ?? 0), 0)
          return Math.max(pm.initial_stock, lastStock + totalAllOrders)
        }
      }
      return pm.initial_stock
    }

    const wb = XLSX.utils.book_new()

    function createSheet(sheetOrders: Order[]) {
      const dataRows:    any[][] = []
      const runningStock = new Map<string, number>()
      const runningKg    = new Map<string, number>()
      const firstCode    = sheetOrders[0]?.product_code ?? ''
      const firstStart   = getStartingStock(firstCode) ?? 0
      const totalKgReq   = sheetOrders.reduce((sum, o) => {
        const wg = o.weight_g ?? productMap.get(o.product_code)?.weight_g ?? 0
        return sum + (o.quantity ?? 0) * (wg / 1000)
      }, 0)
      const headerRow = [
        ...headers,
        firstStart > 0 ? firstStart : '',
        totalKgReq > 0 ? Math.round(totalKgReq * 10) / 10 : '',
      ]

      for (const o of sheetOrders) {
        const pc          = o.product_code
        const deliveryStr = toDateStr(o.delivery_date)
        const deliveryCell = deliveryStr ? new Date(deliveryStr + 'T00:00:00') : ''
        if (!runningStock.has(pc)) {
          const starting = getStartingStock(pc)
          runningStock.set(pc, starting ?? 0)
          const wg = productMap.get(pc)?.weight_g ?? (o.weight_g ?? 0)
          runningKg.set(pc, (starting ?? 0) * (wg / 1000))
        }
        const prevStock = runningStock.get(pc)!
        const prevKg    = runningKg.get(pc)!
        const qty       = o.quantity ?? 0
        const wg        = o.weight_g ?? productMap.get(pc)?.weight_g ?? 0
        const newStock  = prevStock - qty
        const newKg     = prevKg - qty * (wg / 1000)
        runningStock.set(pc, newStock)
        runningKg.set(pc, newKg)
        dataRows.push([
          o.order_no, o.product_code, o.product_name, o.group_name,
          o.lot_number ? `${o.lot_number} (${LOT_LABELS[o.lot_number] ?? ''})` : '',
          deliveryCell, qty, wg || '', o.mfg_lot_no ?? '',
          newStock,
          newStock < 0 ? Math.round(newKg * 10) / 10 : null,
        ])
      }

      const ws    = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows])
      const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')
      for (let r = 1; r <= range.e.r; r++) {
        const dateCell = ws[XLSX.utils.encode_cell({ r, c: 5 })]
        if (dateCell && dateCell.v instanceof Date) { dateCell.t = 'd'; dateCell.z = 'yyyy/mm/dd' }
        const jCell = ws[XLSX.utils.encode_cell({ r, c: 9 })]
        if (jCell && typeof jCell.v === 'number') jCell.z = '0;[Red]-0'
        const kCell = ws[XLSX.utils.encode_cell({ r, c: 10 })]
        if (kCell && typeof kCell.v === 'number') kCell.z = '0.0;[Red]-0.0'
      }
      ws['!cols'] = [
        {wch:14},{wch:20},{wch:18},{wch:8},{wch:14},
        {wch:12},{wch:7},{wch:9},{wch:9},{wch:9},{wch:9},
      ]
      return ws
    }

    if (splitByProduct) {
      const byProduct = new Map<string, Order[]>()
      for (const o of sorted) {
        const key = o.product_name || '(品名なし)'
        if (!byProduct.has(key)) byProduct.set(key, [])
        byProduct.get(key)!.push(o)
      }
      const productOrder = [...byProduct.keys()].sort((a, b) => {
        const oa = sorted.find(o => o.product_name === a)
        const ob = sorted.find(o => o.product_name === b)
        const ga = GROUP_ORDER.indexOf(oa?.group_name ?? '')
        const gb = GROUP_ORDER.indexOf(ob?.group_name ?? '')
        if (ga !== gb) return ga - gb
        return (oa?.product_code ?? '').localeCompare(ob?.product_code ?? '')
      })
      for (const pname of productOrder) {
        const pOrders  = byProduct.get(pname)!
        const safeName = pname.replace(/[\\/*?[\]:]/g, '_').slice(0, 28)
        XLSX.utils.book_append_sheet(wb, createSheet(pOrders), safeName)
      }
      XLSX.utils.book_append_sheet(wb, createSheet(sorted), '全件')
      XLSX.writeFile(wb, `注文一覧_品名別_${date}.xlsx`)
    } else {
      XLSX.utils.book_append_sheet(wb, createSheet(sorted), '注文一覧')
      XLSX.writeFile(wb, `注文一覧_${date}.xlsx`)
    }
    setShowExport(false)
  }

  function ColHeader({ label, colKey, align = 'left' }: { label: string; colKey: string; align?: 'left' | 'right' }) {
    const active = sortKey === colKey
    return (
      <th onClick={() => handleSort(colKey)}
        className={`cursor-pointer select-none px-4 py-2.5 font-medium text-xs whitespace-nowrap text-${align}
          ${active ? 'text-blue-600 bg-blue-50/60' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}>
        {label}<SortIcon state={active ? sortDir : null} />
      </th>
    )
  }

  const uniqueGroups = useMemo(() => GROUP_ORDER.filter(g => orders.some(o => o.group_name === g)), [orders])
  const uniqueLots   = useMemo(() => {
    const s = new Set(orders.map(o => o.lot_number).filter(Boolean))
    return ['1','2','3','4','5','6','7','8','9','10','国①','国②'].filter(l => s.has(l))
  }, [orders])

  return (
    <div className="h-full overflow-auto p-4">
      {/* Export dialog */}
      {showExport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-gray-100 flex-shrink-0">
              <h3 className="text-base font-semibold text-gray-900">注文データを出力</h3>
              <p className="text-xs text-gray-400 mt-0.5">有効な注文のみ — グループと製造番号を選択してください</p>
            </div>
            <div className="px-6 py-4 space-y-5 overflow-y-auto flex-1">
              <div>
                <p className="text-xs font-medium text-gray-600 mb-2">① 原材料グループ</p>
                <div className="flex gap-2 flex-wrap">
                  {GROUP_LIST.map(g => (
                    <button key={g} onClick={() => toggleGroup(g)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        selGroups.has(g) ? 'bg-gray-800 text-white border-gray-800' : 'border-gray-200 text-gray-400 hover:border-gray-300'
                      }`}>{g}</button>
                  ))}
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-gray-600">② 製造番号</p>
                  <div className="flex gap-3">
                    <button onClick={() => setSelMfg(new Set(mfgOptions))} className="text-xs text-blue-500 hover:text-blue-700">全選択</button>
                    <button onClick={() => setSelMfg(new Set())} className="text-xs text-gray-400 hover:text-gray-600">全解除</button>
                  </div>
                </div>
                <div className="border border-gray-200 rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                  {mfgOptions.length === 0 ? (
                    <p className="text-xs text-gray-400 px-3 py-4 text-center">製造番号なし</p>
                  ) : mfgOptions.map(m => (
                    <label key={m} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer border-b border-gray-50 last:border-0">
                      <input type="checkbox" checked={selMfg.has(m)} onChange={() => toggleMfg(m)} className="w-4 h-4 rounded accent-blue-600" />
                      <span className="text-xs font-medium text-blue-700">{m}</span>
                    </label>
                  ))}
                </div>
              </div>
              <label className="flex items-start gap-3 border border-gray-200 rounded-xl px-4 py-3 cursor-pointer hover:bg-gray-50">
                <input type="checkbox" checked={splitByProduct} onChange={e => setSplitByProduct(e.target.checked)} className="w-4 h-4 rounded accent-blue-600 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-gray-700">品名ごとにシートを分ける</p>
                  <p className="text-xs text-gray-400 mt-0.5">Excelのみ対応</p>
                </div>
              </label>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex-shrink-0">
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-400">
                  {exportOrders.length > 0
                    ? `出力対象: ${exportOrders.length.toLocaleString()} 件`
                    : <span className="text-orange-500">← グループを選択してください</span>}
                </p>
                <div className="flex items-center gap-2">
                  <button onClick={() => setShowExport(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">キャンセル</button>
                  <button onClick={() => handleExport('csv')} disabled={exportOrders.length === 0 || splitByProduct}
                    className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-40 transition-colors">CSV</button>
                  <button onClick={() => handleExport('excel')} disabled={exportOrders.length === 0}
                    className="px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-40 rounded-lg transition-colors">Excel</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">注文一覧</h2>
          <p className="text-sm text-gray-400 mt-0.5">
            {filtered.length.toLocaleString()} 件
            {filtered.length !== orders.length && ` / 全 ${orders.length.toLocaleString()} 件`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { setShowExport(true); setSelGroups(new Set()) }}
            className="text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg px-4 py-1.5 transition-colors">出力</button>
          <input type="file" accept=".xlsx,.xls" ref={answerFileRef} className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleAnswerCheck(f); e.target.value = '' }} />
          <button onClick={() => answerFileRef.current?.click()}
            className="text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg px-4 py-1.5 transition-colors">📋 回答納期チェック</button>
          <button onClick={fetchOrders}
            className="text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5">更新</button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4 flex-wrap items-center">
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
          {(['active','cancelled','all'] as const).map(s => (
            <button key={s} onClick={() => { setStatusFilter(s); setPage(0) }}
              className={`px-3 py-1.5 font-medium transition-colors ${statusFilter === s ? 'bg-gray-800 text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
              {s === 'active' ? '有効' : s === 'cancelled' ? '取消' : '全ステータス'}
            </button>
          ))}
        </div>
        <select value={groupFilter} onChange={e => { setGroupFilter(e.target.value); setPage(0) }}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-700 bg-white">
          <option value="">全グループ</option>
          {uniqueGroups.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        <select value={lotFilter} onChange={e => { setLotFilter(e.target.value); setPage(0) }}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-700 bg-white">
          <option value="">全LOT</option>
          {uniqueLots.map(l => <option key={l} value={l}>{l}　{LOT_LABELS[l] ?? ''}</option>)}
        </select>
        <input value={search} onChange={e => { setSearch(e.target.value); setPage(0) }}
          placeholder="注文番号・品番・品名・製造番号で検索..."
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-700 bg-white w-60" />
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-20 text-sm text-gray-400">読み込み中...</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200">
                <tr>
                  <ColHeader label="注文番号"  colKey="order_no" />
                  <ColHeader label="品番"      colKey="product_code" />
                  <ColHeader label="品名"      colKey="product_name" />
                  <ColHeader label="グループ"  colKey="group_name" />
                  <ColHeader label="LOT"       colKey="lot_number" />
                  <ColHeader label="製造番号"  colKey="mfg_lot_no" />
                  <ColHeader label="納期"      colKey="delivery_date" />
                  <ColHeader label="数量"      colKey="quantity" align="right" />
                  <th className="px-4 py-2.5 text-left font-medium text-xs text-gray-500 whitespace-nowrap">ステータス</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {paged.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-16 text-sm text-gray-400">データがありません</td></tr>
                ) : paged.map((o, idx) => {
                  const gc          = GROUP_COLORS[o.group_name] ?? 'bg-gray-50 text-gray-600 border-gray-200'
                  const deliveryStr = toDateStr(o.delivery_date)
                  const deliveryFmt = deliveryStr
                    ? (() => { const d = new Date(deliveryStr + 'T00:00:00'); return `${d.getMonth()+1}/${d.getDate()}` })()
                    : '—'
                  return (
                    <tr key={o.id ?? idx} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-2 font-mono text-gray-600 whitespace-nowrap">{o.order_no}</td>
                      <td className="px-4 py-2 font-mono text-gray-600 whitespace-nowrap">{o.product_code}</td>
                      <td className="px-4 py-2 text-gray-700 whitespace-nowrap max-w-[200px] truncate">{o.product_name}</td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full border ${gc}`}>{o.group_name}</span>
                      </td>
                      <td className="px-4 py-2 text-gray-500 whitespace-nowrap">
                        {o.lot_number ? `${o.lot_number}` : '—'}
                        {o.lot_number && LOT_LABELS[o.lot_number] && (
                          <span className="ml-1 text-gray-400 text-[10px]">{LOT_LABELS[o.lot_number]}</span>
                        )}
                      </td>
                      <td className="px-4 py-2 font-mono text-gray-500 whitespace-nowrap">{o.mfg_lot_no || '—'}</td>
                      <td className="px-4 py-2 text-gray-600 whitespace-nowrap" title={deliveryStr}>{deliveryFmt}</td>
                      <td className="px-4 py-2 text-right font-medium text-gray-700 tabular-nums whitespace-nowrap">
                        {o.quantity?.toLocaleString() ?? '—'}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                          o.status === 'active' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
                        }`}>
                          {o.status === 'active' ? '有効' : '取消'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-xs text-gray-500">
              <span>{(page * PAGE_SIZE + 1).toLocaleString()}–{Math.min((page + 1) * PAGE_SIZE, filtered.length).toLocaleString()} / {filtered.length.toLocaleString()} 件</span>
              <div className="flex gap-1">
                <button onClick={() => setPage(0)}          disabled={page === 0}             className="px-2 py-1 border border-gray-200 rounded disabled:opacity-30">«</button>
                <button onClick={() => setPage(p => p-1)}  disabled={page === 0}             className="px-2 py-1 border border-gray-200 rounded disabled:opacity-30">‹</button>
                <span className="px-3 py-1">{page + 1} / {totalPages}</span>
                <button onClick={() => setPage(p => p+1)}  disabled={page >= totalPages - 1} className="px-2 py-1 border border-gray-200 rounded disabled:opacity-30">›</button>
                <button onClick={() => setPage(totalPages-1)} disabled={page >= totalPages - 1} className="px-2 py-1 border border-gray-200 rounded disabled:opacity-30">»</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}