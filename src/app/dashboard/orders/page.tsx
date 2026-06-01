'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
import { databases, DB_ID, COLLECTIONS } from '@/lib/appwrite'
import { Query } from 'appwrite'
import * as XLSX from 'xlsx'
import { useStock } from '@/lib/stock-context'

// ── Types ─────────────────────────────────────────────────────────────────────
interface Order {
  $id: string
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
  $id: string
  product_code: string
  group_name: string
  weight_g: number | null
  sort_order: number
  initial_stock: number | null
}

interface MaterialOrder {
  $id: string
  material_name: string
  quantity_kg: number
  delivery_date: string
  status: string
  trading_company: string | null
}

interface ProductionPlan {
  $id: string
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

// ── Sort icon ─────────────────────────────────────────────────────────────────
function SortIcon({ state }: { state: 'asc' | 'desc' | null }) {
  if (!state) return <span className="ml-1 text-gray-300 text-[10px]">↕</span>
  return <span className="ml-1 text-blue-500 text-[10px]">{state === 'asc' ? '↑' : '↓'}</span>
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function OrdersPage() {
  const [orders,    setOrders]    = useState<Order[]>([])
  const [products,  setProducts]  = useState<ProductMaster[]>([])
  const [plans,          setPlans]          = useState<ProductionPlan[]>([])
  const [materialOrders, setMaterialOrders] = useState<MaterialOrder[]>([])
  const [loading,   setLoading]   = useState(true)
  const [statusFilter, setStatusFilter] = useState<'active' | 'cancelled' | 'all'>('active')
  const [groupFilter,  setGroupFilter]  = useState('')
  const [lotFilter,    setLotFilter]    = useState('')
  const [search,       setSearch]       = useState('')
  const [sortKey,      setSortKey]      = useState<string>('delivery_date')
  const [sortDir,      setSortDir]      = useState<'asc' | 'desc'>('asc')
  const [page,         setPage]         = useState(0)
  const PAGE_SIZE = 100

  // ── Export state ──────────────────────────────────────────────────────────
  const [showExport,      setShowExport]      = useState(false)
  const [selGroups,       setSelGroups]       = useState<Set<string>>(new Set())
  const [selMfg,          setSelMfg]          = useState<Set<string>>(new Set())
  const [splitByProduct,  setSplitByProduct]  = useState(false)

  const { dailyStock } = useStock()
  const answerFileRef = useRef<HTMLInputElement>(null)

  async function fetchOrders() {
    setLoading(true)
    try {
      const [oRes, pRes, plRes, mRes] = await Promise.all([
        databases.listDocuments(DB_ID, COLLECTIONS.ORDERS, [Query.limit(5000)]),
        databases.listDocuments(DB_ID, COLLECTIONS.PRODUCT_MASTER, [Query.limit(200)]),
        databases.listDocuments(DB_ID, COLLECTIONS.PRODUCTION_PLAN, [Query.limit(2000)]),
        databases.listDocuments(DB_ID, COLLECTIONS.MATERIAL_ORDERS, [Query.limit(500)]),
      ])
      setOrders(oRes.documents as unknown as Order[])
      setProducts(pRes.documents as unknown as ProductMaster[])
      setPlans(plRes.documents as unknown as ProductionPlan[])
      setMaterialOrders(mRes.documents as unknown as MaterialOrder[])
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

    // Only process rows where 品目 (col E) matches our product code pattern
    // Strip leading '=>' that some rows have
    const OUR_PATTERN = /^\d+PP\d+-\d+[PG]\d+/

    // Build starting stock per product (same as getStartingStock in export)
    const productMap = new Map<string, ProductMaster>()
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

    // Pre-compute OK/NG for every active order_no by simulating the running balance
    // Logic: sort each product's orders by delivery_date, deduct qty one by one
    // closing balance >= 0 → OK, < 0 → NG
    const orderResultMap = new Map<string, 'OK' | 'NG'>()
    const byProduct = new Map<string, Order[]>()
    for (const o of orders) {
      if (o.status !== 'active') continue
      if (!byProduct.has(o.product_code)) byProduct.set(o.product_code, [])
      byProduct.get(o.product_code)!.push(o)
    }
    for (const [pc, pOrders] of byProduct) {
      const sorted = [...pOrders].sort((a, b) =>
        (a.delivery_date?.slice(0, 10) ?? '').localeCompare(b.delivery_date?.slice(0, 10) ?? '')
      )
      let running = getStock(pc)
      for (const o of sorted) {
        running -= (o.quantity ?? 0)
        orderResultMap.set(o.order_no, running >= 0 ? 'OK' : 'NG')
      }
    }

    // Find column indices from header row (row 0)
    const header = aoa[0] as any[]
    const orderNoIdx  = header.findIndex((h: any) => String(h ?? '').includes('注文番号'))   ?? 3
    const prodCodeIdx = header.findIndex((h: any) => String(h ?? '').includes('品目'))       ?? 4
    // Write to col O (index 14) as mechanical reference — manual check input goes in col K
    const answerIdx   = 14

    let matched = 0, skipped = 0, okCount = 0, ngCount = 0

    for (let i = 1; i < aoa.length; i++) {
      const row     = aoa[i] as any[]
      const orderNo = String(row[orderNoIdx] ?? '').trim()
      const rawCode = String(row[prodCodeIdx] ?? '').trim()
      const prodCode = rawCode.startsWith('=>') ? rawCode.slice(2).trim() : rawCode

      // Skip rows that aren't our product codes
      if (!orderNo || !OUR_PATTERN.test(prodCode)) { skipped++; continue }

      // Order numbers in Excel have last 3 digits stripped vs our DB
      // e.g. Excel: 'JK5042528', DB: 'JK5042528001'
      // Try exact match first, then try with 001/002/003 suffixes
      let answer = orderResultMap.get(orderNo)
      if (answer === undefined) {
        // Try appending common suffixes
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
        // Order not found in our active orders (cancelled, or product not in our system)
        row[answerIdx] = ''
        skipped++
      }
    }

    // Write output Excel
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
    if (lotFilter)   list = list.filter(o => o.lot_number === lotFilter)
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
      let va: any = (a as any)[sortKey] ?? ''
      let vb: any = (b as any)[sortKey] ?? ''
      if (sortKey === 'quantity') { va = Number(va); vb = Number(vb) }
      const cmp = va < vb ? -1 : va > vb ? 1 : 0
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [orders, statusFilter, groupFilter, lotFilter, search, sortKey, sortDir])

  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)

  function handleSort(key: string) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
    setPage(0)
  }

  // ── Export: mfg_lot options (ALL active, ungated) ─────────────────────────
  const mfgOptions = useMemo(() => {
    // Show all unique mfg_lot_no from active orders — not filtered by group/lot
    // so the user can see all codes immediately and deselect what they don't need
    const nums = Array.from(
      new Set(orders.filter(o => o.status === 'active').map(o => o.mfg_lot_no).filter(Boolean))
    )
    // Sort chronologically using earliest delivery date of each lot
    const earliestDate = new Map<string, string>()
    for (const o of orders) {
      if (!o.mfg_lot_no || !o.delivery_date) continue
      const d = o.delivery_date.slice(0, 10)
      const cur = earliestDate.get(o.mfg_lot_no)
      if (!cur || d < cur) earliestDate.set(o.mfg_lot_no, d)
    }
    return nums.sort((a, b) =>
      (earliestDate.get(a) ?? a).localeCompare(earliestDate.get(b) ?? b)
    )
  }, [orders])

  // Auto-select all mfg options when the list changes
  useEffect(() => {
    setSelMfg(new Set(mfgOptions))
  }, [mfgOptions])

  // Orders that match the export filters — LOT is not a filter here
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

  // ── Earliest delivery date per mfg_lot (for sort) ─────────────────────────
  const mfgLotSortOrder = useMemo(() => {
    const earliest = new Map<string, string>()
    for (const o of orders) {
      if (!o.mfg_lot_no || !o.delivery_date) continue
      const d = o.delivery_date.slice(0, 10)
      const cur = earliest.get(o.mfg_lot_no)
      if (!cur || d < cur) earliest.set(o.mfg_lot_no, d)
    }
    return earliest
  }, [orders])

  // ── Export handler ────────────────────────────────────────────────────────
  function handleExport(format: 'csv' | 'excel') {
    // Sort: primary = delivery_date calendar order, secondary = mfg_lot chronological
    // This ensures per-product rows always go in calendar order.
    // mfg_lot is only used as tiebreaker when two rows have the exact same date.
    const sorted = [...exportOrders].sort((a, b) => {
      const dateA = a.delivery_date?.slice(0, 10) ?? ''
      const dateB = b.delivery_date?.slice(0, 10) ?? ''
      if (dateA !== dateB) return dateA.localeCompare(dateB)
      // Same date: sort by mfg_lot chronological order as tiebreaker
      const mfgA = mfgLotSortOrder.get(a.mfg_lot_no) ?? a.mfg_lot_no ?? ''
      const mfgB = mfgLotSortOrder.get(b.mfg_lot_no) ?? b.mfg_lot_no ?? ''
      return mfgA.localeCompare(mfgB)
    })

    // Column order matches the old format:
    // A: 注文番号, B: 品番, C: 品名, D: グループ, E: LOT, F: 納期, G: 数量, H: 重量(g), I: 製造番号
    // J: 在庫残(個) — running count balance  (header = starting total)
    // K: 在庫残(kg) — running weight balance (header = starting total in kg)
    const headers = ['注文番号', '品番', '品名', 'グループ', 'LOT', '納期', '数量', '重量(g)', '製造番号']

    const date = new Date().toISOString().slice(0, 10)

    if (format === 'csv') {
      // CSV: no running balance columns, simple flat export
      const rows = sorted.map(o => {
        const deliveryStr = o.delivery_date?.slice(0, 10) ?? ''
        return [
          o.order_no,
          o.product_code,
          o.product_name,
          o.group_name,
          o.lot_number ? `${o.lot_number} (${LOT_LABELS[o.lot_number] ?? ''})` : '',
          deliveryStr.replace(/-/g, '/'),
          o.quantity,
          o.weight_g ?? '',
          o.mfg_lot_no ?? '',
        ]
      })
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, '注文一覧')
      XLSX.writeFile(wb, `注文一覧_${date}.csv`, { bookType: 'csv' })
      setShowExport(false)
      return
    }

    // ── Excel export ────────────────────────────────────────────────────────
    // Build starting stock per product_code:
    // starting stock = initial_stock (from product master) + sum of feasible production
    // Feasible production per product is available in dailyStock (already material-capped).
    // We derive it as: the maximum stock value in dailyStock before any shipments,
    // which equals initial_stock + all feasible production before the first shipment date.
    // Simpler: use initial_stock from product master + read feasible total from dailyStock context.
    const productMap = new Map<string, ProductMaster>()
    for (const p of products) productMap.set(p.product_code, p)

    // Compute starting stock per product = initial_stock + feasible planned production total
    // We get feasible production from dailyStock: find the stock value just before the
    // first shipment for this product. That value = initial_stock + all production before it.
    // If dailyStock not available, fall back to initial_stock only.
    function getStartingStock(productCode: string): number | null {
      const pm = productMap.get(productCode)
      if (!pm || pm.initial_stock === null) return null

      if (dailyStock) {
        const pDailyMap = dailyStock.byProduct.get(productCode)
        if (pDailyMap && pDailyMap.size > 0) {
          // Correct approach: starting stock = final dailyStock value + ALL active orders
          // dailyStock is computed from ALL active orders (not just export subset)
          // so we must use ALL orders here too.
          // Formula: starting = lastStock + totalAllActiveOrders
          // because: starting - totalAllActiveOrders = lastStock
          const sortedDates  = Array.from(pDailyMap.keys()).sort()
          const lastStock    = pDailyMap.get(sortedDates[sortedDates.length - 1]) ?? pm.initial_stock
          const totalAllOrders = orders
            .filter(o => o.product_code === productCode && o.status === 'active')
            .reduce((s, o) => s + (o.quantity ?? 0), 0)
          const derived = lastStock + totalAllOrders
          return Math.max(pm.initial_stock, derived)
        }
      }
      return pm.initial_stock
    }

    const wb = XLSX.utils.book_new()

    const createSheet = (sheetOrders: Order[], sheetName: string) => {
      // Compute starting stock for this product set
      // (for 品名別 sheets, all orders are the same product so one starting stock)
      // For 全件, each product has its own running balance — we interleave.
      // Running balance resets per product_code when it changes.

      const dataRows: any[][] = []
      // Track running balance per product
      const runningStock = new Map<string, number>()  // product_code → current stock count
      const runningKg    = new Map<string, number>()  // product_code → current stock kg

      // J1 header: starting stock count for the first product on this sheet
      // K1 header: total kg required across ALL orders on this sheet (sum of qty × weight_g / 1000)
      const firstCode = sheetOrders[0]?.product_code ?? ''
      const firstStarting = getStartingStock(firstCode) ?? 0
      const totalKgRequired = sheetOrders.reduce((sum, o) => {
        const wg = o.weight_g ?? productMap.get(o.product_code)?.weight_g ?? 0
        return sum + (o.quantity ?? 0) * (wg / 1000)
      }, 0)

      const headerRow = [
        ...headers,
        firstStarting > 0 ? firstStarting : '',
        totalKgRequired > 0 ? Math.round(totalKgRequired * 10) / 10 : '',
      ]

      for (const o of sheetOrders) {
        const pc = o.product_code
        const deliveryDateStr = o.delivery_date?.slice(0, 10) ?? ''
        const deliveryCell = deliveryDateStr ? new Date(deliveryDateStr + 'T00:00:00') : ''

        // Initialize running balance when we encounter a new product
        if (!runningStock.has(pc)) {
          const starting = getStartingStock(pc)
          runningStock.set(pc, starting ?? 0)
          const wg = productMap.get(pc)?.weight_g ?? (o.weight_g ?? 0)
          runningKg.set(pc, (starting ?? 0) * (wg / 1000))
        }

        // Deduct this order's quantity from running balance
        const prevStock = runningStock.get(pc)!
        const prevKg    = runningKg.get(pc)!
        const qty       = o.quantity ?? 0
        const wg        = o.weight_g ?? productMap.get(pc)?.weight_g ?? 0
        const newStock  = prevStock - qty
        const newKg     = prevKg - qty * (wg / 1000)
        runningStock.set(pc, newStock)
        runningKg.set(pc, newKg)

        dataRows.push([
          o.order_no,
          o.product_code,
          o.product_name,
          o.group_name,
          o.lot_number ? `${o.lot_number} (${LOT_LABELS[o.lot_number] ?? ''})` : '',
          deliveryCell,
          qty,
          wg || '',
          o.mfg_lot_no ?? '',
          newStock,
          // K: only show kg balance when J (stock count) is negative — blank when positive
          newStock < 0 ? Math.round(newKg * 10) / 10 : null,
        ])
      }

      const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows])

      // Date format for 納期 column F (index 5)
      const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')
      for (let r = 1; r <= range.e.r; r++) {
        // Date format on col F
        const dateCell = ws[XLSX.utils.encode_cell({ r, c: 5 })]
        if (dateCell && dateCell.v instanceof Date) {
          dateCell.t = 'd'
          dateCell.z = 'yyyy/mm/dd'
        }

        // J column (index 9): integer, negative shown in red via format code
        const jCell = ws[XLSX.utils.encode_cell({ r, c: 9 })]
        if (jCell && typeof jCell.v === 'number') {
          // Format: positive = black integer, negative = red integer
          jCell.z = '0;[Red]-0'
        }

        // K column (index 10): 1 decimal place, red — only written when negative so no positive values appear
        const kCell = ws[XLSX.utils.encode_cell({ r, c: 10 })]
        if (kCell && typeof kCell.v === 'number') {
          kCell.z = '0.0;[Red]-0.0'
        }
      }

      // Column widths matching the old format
      ws['!cols'] = [
        { wch: 14 }, // A: 注文番号
        { wch: 20 }, // B: 品番
        { wch: 18 }, // C: 品名
        { wch: 8  }, // D: グループ
        { wch: 14 }, // E: LOT
        { wch: 12 }, // F: 納期
        { wch: 7  }, // G: 数量
        { wch: 9  }, // H: 重量(g)
        { wch: 9  }, // I: 製造番号
        { wch: 9  }, // J: 在庫残(個)
        { wch: 9  }, // K: 在庫残(kg)
      ]

      return ws
    }

    // ── 材料入荷予定 sheet ──────────────────────────────────────────────────
    // Table 1: Material orders list
    // Table 2: Initial stock per group
    function createMaterialSheet(): XLSX.WorkSheet {
      const rows: any[][] = []

      // Section 1 header
      rows.push(['【原材料発注リスト】'])
      rows.push(['原材料', '発注先', '数量(kg)', '入荷予定日', 'ステータス'])

      const STATUS_LABELS: Record<string, string> = {
        'initial_stock':       '初期在庫',
        'pending':             '保留中',
        'ordered':             '発注済・確認待',
        'confirmed':           '確認済',
        'delivery_confirmed':  '納入確定',
        'delayed':             '遅延',
      }

      // Sort material orders by material_name then delivery_date
      const sortedMat = [...materialOrders].sort((a, b) => {
        if (a.material_name !== b.material_name)
          return GROUP_ORDER.indexOf(a.material_name) - GROUP_ORDER.indexOf(b.material_name)
        return (a.delivery_date ?? '').localeCompare(b.delivery_date ?? '')
      })

      for (const mo of sortedMat) {
        if (mo.status === 'initial_stock') continue  // shown in section 2
        const rawDate = mo.delivery_date?.slice(0, 10) ?? ''
        const [dy, dm, dd] = rawDate ? rawDate.split('-') : ['','','']
        const dateStr = rawDate ? `${dy}/${dm}/${dd}` : ''
        rows.push([
          mo.material_name,
          mo.trading_company ?? '—',
          mo.quantity_kg,
          dateStr,
          STATUS_LABELS[mo.status] ?? mo.status,
        ])
      }

      rows.push([])  // blank row

      // Section 2: Initial stock
      rows.push(['【初期在庫（原材料）】'])
      rows.push(['原材料', '初期在庫(kg)', '基準日'])

      for (const g of GROUP_ORDER) {
        const initRow = materialOrders
          .filter(mo => mo.material_name === g && mo.status === 'initial_stock')
          .sort((a, b) => b.delivery_date.localeCompare(a.delivery_date))[0]
        if (initRow) {
          const [iy, im, id2] = initRow.delivery_date.slice(0, 10).split('-')
          rows.push([g, initRow.quantity_kg, `${iy}/${im}/${id2}`])
        } else {
          rows.push([g, 0, '—'])
        }
      }

      rows.push([])  // blank row

      // Section 3: Group totals (confirmed + initial) + production consumption
      rows.push(['【材料グループ別 確定在庫合計】'])

      // Calculate production already consumed up to today
      // Only count plan weeks that have ENDED before today
      // i.e. week_start_date of the plan's Monday <= last completed week's Monday
      // "last completed week" = the Monday of the week BEFORE the current week
      const productMapLocal = new Map<string, ProductMaster>()
      for (const p of products) productMapLocal.set(p.product_code, p)

      // Use this week's Monday as cutoff — include current week since production is ongoing
      const todayDate = new Date()
      const dow = todayDate.getDay()
      const diffToMonday = dow === 0 ? -6 : 1 - dow
      const thisMonday = new Date(todayDate)
      thisMonday.setDate(todayDate.getDate() + diffToMonday)
      const lastCompletedMondayStr = `${thisMonday.getFullYear()}-${String(thisMonday.getMonth()+1).padStart(2,'0')}-${String(thisMonday.getDate()).padStart(2,'0')}`

      const productionConsumptionByGroup = new Map<string, number>()
      for (const g of GROUP_ORDER) productionConsumptionByGroup.set(g, 0)

      // Header row placed here so lastCompletedMondayStr is in scope
      rows.push(['原材料', '初期在庫(kg)', '入荷済(kg)', '合計(kg)', `製造消費済(kg)〜${lastCompletedMondayStr}`, '現時点残在庫(kg)', '備考'])
      for (const pl of plans) {
        // Only include weeks that have fully completed (week start <= last completed Monday)
        const planWeekStr = pl.week_start_date?.slice(0, 10) ?? ''
        if (planWeekStr > lastCompletedMondayStr) continue
        const pm = productMapLocal.get(pl.product_code)
        if (!pm?.weight_g || !pm.group_name) continue
        const kg = (pl.planned_quantity * pm.weight_g) / 1000
        productionConsumptionByGroup.set(
          pm.group_name,
          (productionConsumptionByGroup.get(pm.group_name) ?? 0) + kg
        )
      }

      const today = new Date().toISOString().slice(0, 10)
      for (const g of GROUP_ORDER) {
        // Cutoff = end of current week (Friday JST) converted to UTC date string
        // This ensures all arrivals scheduled THIS week or earlier are counted,
        // matching the same week boundary used for production consumption.
        // JST Friday end-of-day = Saturday UTC, so we use Saturday's date as cutoff.
        const cutoffDate = new Date()
        const dowCutoff  = cutoffDate.getDay() // 0=Sun, 1=Mon ... 6=Sat
        const daysToFriday = dowCutoff === 0 ? 5 : 6 - dowCutoff  // days until Friday
        cutoffDate.setDate(cutoffDate.getDate() + daysToFriday + 1) // +1 for JST→UTC offset
        const cutoffStr = cutoffDate.toISOString().slice(0, 10)

        const initKg = materialOrders
          .filter(mo => mo.material_name === g && mo.status === 'initial_stock')
          .reduce((s, mo) => s + mo.quantity_kg, 0)
        // Count confirmed arrivals up to end of current week (JST)
        const confirmedKg = materialOrders
          .filter(mo =>
            mo.material_name === g &&
            (mo.status === 'confirmed' || mo.status === 'delivery_confirmed') &&
            mo.delivery_date.slice(0, 10) <= cutoffStr
          )
          .reduce((s, mo) => s + mo.quantity_kg, 0)
        // Future confirmed arrivals beyond this week
        const futureConfirmedKg = materialOrders
          .filter(mo =>
            mo.material_name === g &&
            (mo.status === 'confirmed' || mo.status === 'delivery_confirmed') &&
            mo.delivery_date.slice(0, 10) > cutoffStr
          )
          .reduce((s, mo) => s + mo.quantity_kg, 0)
        const pendingKg = materialOrders
          .filter(mo => mo.material_name === g && mo.status === 'ordered')
          .reduce((s, mo) => s + mo.quantity_kg, 0)
        const totalKg       = initKg + confirmedKg
        const consumptionKg = Math.round((productionConsumptionByGroup.get(g) ?? 0) * 10) / 10
        const remainingKg   = Math.round((totalKg - consumptionKg) * 10) / 10
        rows.push([
          g,
          initKg,
          confirmedKg,
          totalKg,
          consumptionKg,
          remainingKg,
          [
            pendingKg > 0 ? `発注中: ${pendingKg}kg（未確定）` : '',
            futureConfirmedKg > 0 ? `確定入荷待ち: ${futureConfirmedKg}kg` : '',
          ].filter(Boolean).join(' / ') || '',
        ])
      }

      const ws = XLSX.utils.aoa_to_sheet(rows)

      // Format ALL cells: dates first, then numbers (skip already-formatted date cells)
      const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')
      for (let r = 0; r <= range.e.r; r++) {
        for (let c = 0; c <= range.e.c; c++) {
          const cell = ws[XLSX.utils.encode_cell({ r, c })]
          if (!cell) continue
          if (cell.v instanceof Date) {
            cell.t = 'd'
            cell.z = 'yyyy/mm/dd'
          } else if (typeof cell.v === 'number' && cell.t !== 'd') {
            cell.z = '#,##0.0'
          }
        }
      }

      ws['!cols'] = [
        { wch: 10 }, // A: 原材料 / 発注先
        { wch: 16 }, // B: 発注先 / 初期在庫
        { wch: 14 }, // C: 数量 / 確認済入荷
        { wch: 14 }, // D: 入荷予定日 / 合計
        { wch: 18 }, // E: ステータス / 製造消費予定
        { wch: 16 }, // F: 製造後残在庫
        { wch: 22 }, // G: 備考
      ]

      return ws
    }

    // ── 初期在庫計算 sheet ──────────────────────────────────────────────────
    // Shows: 品番 | 品名 | 初期在庫 | [week1] | ... | [weekN] | 合計製造 | 在庫合計
    // Only products that belong to the selected groups are included.
    // Week columns = feasible (material-capped) production quantity that week.
    // 合計製造 = sum of feasible production across all weeks.
    // 在庫合計 = initial_stock + 合計製造  ← this equals J1 on the order sheets.
    const createInitialStockSheet = () => {
      // Build effective plan map: same greedy-walk logic as production page
      // We use the effectivePlanMap already computed in getStartingStock via dailyStock,
      // but here we need the per-week breakdown, so we read directly from plans + dailyStock.
      // Approach: planMap gives planned qty per product per week.
      // effectiveQty per week = min(planned, what material allows) — approximated by:
      //   if dailyStock covers that week's production end date stock increase, use planned qty,
      //   otherwise use 0 (or reduced). For simplicity and accuracy we derive from dailyStock:
      //   effectiveQty for week W = stock increase between weekEnd(W-1) and weekEnd(W) + shipments that week.
      // Simplest reliable approach: read planned quantities from plans, and cap using dailyStock.
      // We compute: for each product, the feasible total = getStartingStock(pc) - initial_stock.
      // Then distribute that feasible total across weeks proportionally to planned quantities.
      // This gives exact per-week feasible numbers matching what the production page shows.

      // Build planMap: product_code → weekMonday → planned_quantity
      const getMondayStr = (dateStr: string): string => {
        const d = new Date(dateStr + 'T00:00:00')
        const dow = d.getDay()
        const diff = dow === 0 ? -6 : 1 - dow
        d.setDate(d.getDate() + diff)
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
      }
      const getWeekEndStr = (monday: string): string => {
        for (let i = 4; i >= 0; i--) {
          const d = new Date(monday + 'T00:00:00')
          d.setDate(d.getDate() + i)
          const dow = d.getDay()
          if (dow !== 0 && dow !== 6) {
            return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
          }
        }
        return monday
      }
      const formatWeekLabel = (monday: string): string => {
        const end = getWeekEndStr(monday)
        const m1 = new Date(monday + 'T00:00:00').getMonth() + 1
        const d1 = new Date(monday + 'T00:00:00').getDate()
        const m2 = new Date(end + 'T00:00:00').getMonth() + 1
        const d2 = new Date(end + 'T00:00:00').getDate()
        return m1 === m2 ? `${m1}/${d1}–${d2}` : `${m1}/${d1}–${m2}/${d2}`
      }

      // Collect all weeks that have any planned production, sorted chronologically
      const weekSet = new Set<string>()
      for (const pl of plans) weekSet.add(getMondayStr(pl.week_start_date))
      const allWeeks = Array.from(weekSet).sort()

      // planMap: product → week → planned qty
      const planMap = new Map<string, Map<string, number>>()
      for (const pl of plans) {
        const wk = getMondayStr(pl.week_start_date)
        if (!planMap.has(pl.product_code)) planMap.set(pl.product_code, new Map())
        planMap.get(pl.product_code)!.set(wk, pl.planned_quantity)
      }

      // For each product, compute feasible qty per week.
      // We know total feasible = getStartingStock(pc) - initial_stock.
      // Distribute across weeks: if total planned > feasible total, cap greedily week by week.
      // This matches exactly what the production page shows (greedy walk by sort_order within group).
      // Since we already have dailyStock which has the result of that greedy walk baked in,
      // we can derive per-week feasible as: the stock increase at weekEnd vs weekEnd of prior week.

      const feasiblePerWeek = new Map<string, Map<string, number>>() // pc → week → feasible qty

      for (const pm of products) {
        if (!selGroups.has(pm.group_name)) continue
        const pc = pm.product_code
        const pPlanMap = planMap.get(pc)
        if (!pPlanMap || pPlanMap.size === 0) continue

        const pDailyMap = dailyStock?.byProduct.get(pc)
        const initStock = pm.initial_stock ?? 0
        const wkMap = new Map<string, number>()

        if (pDailyMap && pDailyMap.size > 0) {
          // Derive per-week production from dailyStock:
          // At each weekEnd, stock = prev_stock + production_this_week - shipments_this_week
          // We know shipments from orders, so: production = stock_change + shipments
          const sortedDates = Array.from(pDailyMap.keys()).sort()

          for (const wk of allWeeks) {
            const planned = pPlanMap.get(wk) ?? 0
            if (planned === 0) { wkMap.set(wk, 0); continue }

            const wkEnd = getWeekEndStr(wk)
            // Find stock value at or just after weekEnd
            const endStock = pDailyMap.get(wkEnd) ??
              (() => {
                const before = sortedDates.filter(d => d <= wkEnd)
                return before.length > 0 ? pDailyMap.get(before[before.length - 1])! : null
              })()

            // Find stock value just before this week started
            const prevWeekEnd = allWeeks.indexOf(wk) > 0
              ? getWeekEndStr(allWeeks[allWeeks.indexOf(wk) - 1])
              : null
            const prevStock = prevWeekEnd
              ? (pDailyMap.get(prevWeekEnd) ??
                (() => {
                  const before = sortedDates.filter(d => d <= prevWeekEnd)
                  return before.length > 0 ? pDailyMap.get(before[before.length - 1])! : initStock
                })())
              : initStock

            // Shipments in this week
            const wkStart = wk
            const weekShipments = orders.filter(o =>
              o.product_code === pc &&
              o.status === 'active' &&
              o.delivery_date?.slice(0, 10) >= wkStart &&
              o.delivery_date?.slice(0, 10) <= wkEnd
            ).reduce((s, o) => s + (o.quantity ?? 0), 0)

            if (endStock !== null) {
              // production = (endStock - prevStock) + weekShipments
              const derived = (endStock - prevStock) + weekShipments
              wkMap.set(wk, Math.max(0, Math.min(planned, Math.round(derived))))
            } else {
              wkMap.set(wk, planned)
            }
          }
        } else {
          // No dailyStock — use planned quantities as-is
          for (const wk of allWeeks) wkMap.set(wk, pPlanMap.get(wk) ?? 0)
        }

        feasiblePerWeek.set(pc, wkMap)
      }

      // Build sheet rows
      // Only include products in selected groups that have initial_stock set
      const sheetProducts = products
        .filter(p => selGroups.has(p.group_name) && p.initial_stock !== null)
        .sort((a, b) => {
          const ga = GROUP_ORDER.indexOf(a.group_name)
          const gb = GROUP_ORDER.indexOf(b.group_name)
          if (ga !== gb) return ga - gb
          return a.sort_order - b.sort_order
        })

      // Name map from orders
      const nameMap = new Map<string, string>()
      for (const o of orders) {
        if (o.product_name && !nameMap.has(o.product_code)) nameMap.set(o.product_code, o.product_name)
      }

      // Relevant weeks = any week with planned qty (feasible OR infeasible) for selected products
      // This ensures pending-only weeks (all infeasible) still appear
      const relevantWeeks = allWeeks.filter(wk =>
        sheetProducts.some(p => (planMap.get(p.product_code)?.get(wk) ?? 0) > 0)
      )

      const headerRow = [
        '品番', '品名', '初期在庫',
        ...relevantWeeks.map(formatWeekLabel),
        '合計製造', '在庫合計',
        '未確定計画',  // total infeasible (bracketed) qty for reference
      ]

      const dataRows: any[][] = sheetProducts.map(pm => {
        const pc = pm.product_code
        const initStock = pm.initial_stock ?? 0
        const wkFeasible = feasiblePerWeek.get(pc)
        const pPlanMap   = planMap.get(pc)

        // For each week: build display value
        // - feasible only → number (sortable, formattable)
        // - feasible + infeasible → string "N,NNN (N,NNN)" where second is infeasible portion
        // - infeasible only (feasible=0) → string "(N,NNN)"
        // - nothing planned → null (blank)
        const weekCells = relevantWeeks.map(wk => {
          const planned   = pPlanMap?.get(wk) ?? 0
          const feasible  = wkFeasible?.get(wk) ?? 0
          const infeasible = Math.max(0, planned - feasible)

          if (planned === 0) return null  // blank

          if (infeasible === 0) {
            // Fully feasible — plain number so Excel can format it
            return feasible
          }
          if (feasible === 0) {
            // Entirely infeasible — string with parentheses
            return `(${infeasible.toLocaleString()})`
          }
          // Mixed — string showing both
          return `${feasible.toLocaleString()} (${infeasible.toLocaleString()})`
        })

        const totalFeasible    = relevantWeeks.reduce((s, wk) => s + (wkFeasible?.get(wk) ?? 0), 0)
        const totalInfeasible  = relevantWeeks.reduce((s, wk) => {
          const planned  = pPlanMap?.get(wk) ?? 0
          const feasible = wkFeasible?.get(wk) ?? 0
          return s + Math.max(0, planned - feasible)
        }, 0)
        const startingTotal = initStock + totalFeasible

        return [
          pc,
          nameMap.get(pc) ?? '',
          initStock,
          ...weekCells,
          totalFeasible  || null,
          startingTotal,
          totalInfeasible > 0 ? `(${totalInfeasible.toLocaleString()})` : null,
        ]
      })

      const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows])

      // Format: integer for stock columns, highlight 在庫合計
      const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')
      for (let r = 1; r <= range.e.r; r++) {
        for (let c = 2; c <= range.e.c; c++) {
          const cell = ws[XLSX.utils.encode_cell({ r, c })]
          if (cell && typeof cell.v === 'number') {
            cell.z = '#,##0'
          }
        }
      }

      // Column widths
      ws['!cols'] = [
        { wch: 22 }, // 品番
        { wch: 20 }, // 品名
        { wch: 10 }, // 初期在庫
        ...relevantWeeks.map(() => ({ wch: 12 })),
        { wch: 10 }, // 合計製造
        { wch: 10 }, // 在庫合計
        { wch: 12 }, // 未確定計画
      ]

      return ws
    }

    // ── 在庫枯渇サマリー sheet ──────────────────────────────────────────────
    // Shows only products with stock runout: グループ | 品番 | 品名 | 枯渇注文番号 | 枯渇納期 | 製造番号
    function createRunoutSheet(): XLSX.WorkSheet {
      // Group all export orders by product
      const byProduct = new Map<string, Order[]>()
      for (const o of sorted) {
        if (!byProduct.has(o.product_code)) byProduct.set(o.product_code, [])
        byProduct.get(o.product_code)!.push(o)
      }

      // Sort products by group order then product code
      const productCodes = [...byProduct.keys()].sort((a, b) => {
        const oa = sorted.find(o => o.product_code === a)
        const ob = sorted.find(o => o.product_code === b)
        const ga = GROUP_ORDER.indexOf(oa?.group_name ?? '')
        const gb = GROUP_ORDER.indexOf(ob?.group_name ?? '')
        if (ga !== gb) return ga - gb
        return a.localeCompare(b)
      })

      const headerRow = [
        'グループ', '品番', '品名',
        '枯渇注文番号', '枯渇納期', '製造番号(枯渇時)',
      ]

      const dataRows: any[][] = []

      for (const pc of productCodes) {
        const pOrders  = byProduct.get(pc)!
        const group    = pOrders[0]?.group_name ?? ''
        const name     = pOrders[0]?.product_name ?? ''
        const starting = getStartingStock(pc) ?? 0

        let running     = starting
        let runoutOrder: Order | null = null

        for (const o of pOrders) {
          const qty = o.quantity ?? 0
          running -= qty
          if (running < 0 && runoutOrder === null) {
            runoutOrder = o
          }
        }

        // Only include products that run out
        if (runoutOrder) {
          const deliveryDate = runoutOrder.delivery_date?.slice(0, 10)
          const deliveryCell = deliveryDate ? new Date(deliveryDate + 'T00:00:00') : ''
          dataRows.push([
            group, pc, name,
            runoutOrder.order_no,
            deliveryCell,
            runoutOrder.mfg_lot_no ?? '',
          ])
        }
      }

      // Sort by runout date chronologically
      dataRows.sort((a, b) => {
        const aDate = a[4] instanceof Date ? a[4].getTime() : 0
        const bDate = b[4] instanceof Date ? b[4].getTime() : 0
        return aDate - bDate
      })

      const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows])

      // Format date column (index 4)
      const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')
      for (let r = 1; r <= range.e.r; r++) {
        const dateCell = ws[XLSX.utils.encode_cell({ r, c: 4 })]
        if (dateCell && dateCell.v instanceof Date) {
          dateCell.t = 'd'
          dateCell.z = 'yyyy/mm/dd'
        }
      }

      ws['!cols'] = [
        { wch: 8  }, // グループ
        { wch: 22 }, // 品番
        { wch: 18 }, // 品名
        { wch: 16 }, // 枯渇注文番号
        { wch: 14 }, // 枯渇納期
        { wch: 14 }, // 製造番号(枯渇時)
      ]

      return ws
    }

    if (splitByProduct) {
      // Group by product_name, maintain mfg_lot/date sort within each sheet
      const byProduct = new Map<string, Order[]>()
      for (const o of sorted) {
        const key = o.product_name || '(品名なし)'
        if (!byProduct.has(key)) byProduct.set(key, [])
        byProduct.get(key)!.push(o)
      }

      // Sort product sheets by group order then product code
      const productOrder = [...byProduct.keys()].sort((a, b) => {
        const oa = sorted.find(o => o.product_name === a)
        const ob = sorted.find(o => o.product_name === b)
        const ga = GROUP_ORDER.indexOf(oa?.group_name ?? '')
        const gb = GROUP_ORDER.indexOf(ob?.group_name ?? '')
        if (ga !== gb) return ga - gb
        return (oa?.product_code ?? '').localeCompare(ob?.product_code ?? '')
      })

      // 在庫枯渇サマリー — first sheet for quick review
      XLSX.utils.book_append_sheet(wb, createRunoutSheet(), '在庫枯渇サマリー')
      // 初期在庫計算 — second
      XLSX.utils.book_append_sheet(wb, createInitialStockSheet(), '初期在庫計算')
      // 材料入荷予定 — third
      XLSX.utils.book_append_sheet(wb, createMaterialSheet(), '材料入荷予定')

      for (const pname of productOrder) {
        const pOrders = byProduct.get(pname)!
        const safeName = pname.replace(/[\\/*?[\]:]/g, '_').slice(0, 28)
        XLSX.utils.book_append_sheet(wb, createSheet(pOrders, safeName), safeName)
      }
      // Full summary sheet last
      XLSX.utils.book_append_sheet(wb, createSheet(sorted, '全件'), '全件')
      XLSX.writeFile(wb, `注文一覧_品名別_${date}.xlsx`)
    } else {
      // 在庫枯渇サマリー — first sheet
      XLSX.utils.book_append_sheet(wb, createRunoutSheet(), '在庫枯渇サマリー')
      // 初期在庫計算 — second
      XLSX.utils.book_append_sheet(wb, createInitialStockSheet(), '初期在庫計算')
      // 材料入荷予定 — third
      XLSX.utils.book_append_sheet(wb, createMaterialSheet(), '材料入荷予定')
      // 注文一覧 — detail
      XLSX.utils.book_append_sheet(wb, createSheet(sorted, '注文一覧'), '注文一覧')

      XLSX.writeFile(wb, `注文一覧_${date}.xlsx`)
    }

    setShowExport(false)
  }

  // ── Render helpers ────────────────────────────────────────────────────────
  function ColHeader({ label, colKey, align = 'left' }: {
    label: string; colKey: string; align?: 'left' | 'right'
  }) {
    const active = sortKey === colKey
    return (
      <th
        onClick={() => handleSort(colKey)}
        className={`cursor-pointer select-none px-4 py-2.5 font-medium text-xs whitespace-nowrap text-${align}
          ${active ? 'text-blue-600 bg-blue-50/60' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
      >
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

      {/* ── Export dialog ─────────────────────────────────────────────────── */}
      {showExport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 flex flex-col max-h-[90vh]">

            <div className="px-6 py-4 border-b border-gray-100 flex-shrink-0">
              <h3 className="text-base font-semibold text-gray-900">注文データを出力</h3>
              <p className="text-xs text-gray-400 mt-0.5">有効な注文のみ — グループと製造番号を選択してください</p>
            </div>

            <div className="px-6 py-4 space-y-5 overflow-y-auto flex-1">

              {/* ① Group */}
              <div>
                <p className="text-xs font-medium text-gray-600 mb-2">① 原材料グループ</p>
                <div className="flex gap-2 flex-wrap">
                  {GROUP_LIST.map(g => (
                    <button key={g} onClick={() => toggleGroup(g)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        selGroups.has(g)
                          ? 'bg-gray-800 text-white border-gray-800'
                          : 'border-gray-200 text-gray-400 hover:border-gray-300'
                      }`}>
                      {g}
                    </button>
                  ))}
                </div>
              </div>

              {/* ② 製造番号 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-gray-600">
                    ② 製造番号
                    <span className="ml-1 font-normal text-gray-400">（全件表示 — チェックで出力対象を絞り込み）</span>
                  </p>
                  <div className="flex gap-3">
                    <button onClick={() => setSelMfg(new Set(mfgOptions))}
                      className="text-xs text-blue-500 hover:text-blue-700">全選択</button>
                    <button onClick={() => setSelMfg(new Set())}
                      className="text-xs text-gray-400 hover:text-gray-600">全解除</button>
                  </div>
                </div>
                <div className="border border-gray-200 rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                  {mfgOptions.length === 0 ? (
                    <p className="text-xs text-gray-400 px-3 py-4 text-center">製造番号なし</p>
                  ) : (
                    mfgOptions.map(m => (
                      <label key={m}
                        className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer border-b border-gray-50 last:border-0">
                        <input type="checkbox" checked={selMfg.has(m)} onChange={() => toggleMfg(m)}
                          className="w-4 h-4 rounded accent-blue-600" />
                        <span className="text-xs font-medium text-blue-700">{m}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>

              {/* ④ Split by product option */}
              <label className="flex items-start gap-3 border border-gray-200 rounded-xl px-4 py-3 cursor-pointer hover:bg-gray-50">
                <input type="checkbox" checked={splitByProduct} onChange={e => setSplitByProduct(e.target.checked)}
                  className="w-4 h-4 rounded accent-blue-600 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-gray-700">品名ごとにシートを分ける</p>
                  <p className="text-xs text-gray-400 mt-0.5">Excelのみ対応 — 品名別シート＋全件シートを作成</p>
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
                  <button onClick={() => setShowExport(false)}
                    className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">キャンセル</button>
                  <button onClick={() => handleExport('csv')}
                    disabled={exportOrders.length === 0 || splitByProduct}
                    title={splitByProduct ? '品名別シート分割はExcelのみ対応' : ''}
                    className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-40 transition-colors">
                    CSV
                  </button>
                  <button onClick={() => handleExport('excel')}
                    disabled={exportOrders.length === 0}
                    className="px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-40 rounded-lg transition-colors">
                    Excel
                  </button>
                </div>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* ── Page header ───────────────────────────────────────────────────── */}
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
            className="text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg px-4 py-1.5 transition-colors">
            出力
          </button>
          <input type="file" accept=".xlsx,.xls" ref={answerFileRef} className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleAnswerCheck(f); e.target.value = '' }}/>
          <button onClick={() => answerFileRef.current?.click()}
            className="text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg px-4 py-1.5 transition-colors">
            📋 回答納期チェック
          </button>
          <button onClick={fetchOrders}
            className="text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5">
            更新
          </button>
        </div>
      </div>

      {/* ── Filters ───────────────────────────────────────────────────────── */}
      <div className="flex gap-2 mb-4 flex-wrap items-center">
        {/* Status */}
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
          {(['active','cancelled','all'] as const).map(s => (
            <button key={s} onClick={() => { setStatusFilter(s); setPage(0) }}
              className={`px-3 py-1.5 font-medium transition-colors ${
                statusFilter === s ? 'bg-gray-800 text-white' : 'text-gray-500 hover:bg-gray-50'
              }`}>
              {s === 'active' ? '有効' : s === 'cancelled' ? '取消' : '全ステータス'}
            </button>
          ))}
        </div>

        {/* Group */}
        <select value={groupFilter} onChange={e => { setGroupFilter(e.target.value); setPage(0) }}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-700 bg-white">
          <option value="">全グループ</option>
          {uniqueGroups.map(g => <option key={g} value={g}>{g}</option>)}
        </select>

        {/* LOT */}
        <select value={lotFilter} onChange={e => { setLotFilter(e.target.value); setPage(0) }}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-700 bg-white">
          <option value="">全LOT</option>
          {uniqueLots.map(l => (
            <option key={l} value={l}>{l}　{LOT_LABELS[l] ?? ''}</option>
          ))}
        </select>

        {/* Search */}
        <input value={search} onChange={e => { setSearch(e.target.value); setPage(0) }}
          placeholder="注文番号・品番・品名・製造番号で検索..."
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-700 bg-white w-60" />
      </div>

      {/* ── Table ─────────────────────────────────────────────────────────── */}
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
                ) : paged.map(o => {
                  const gc = GROUP_COLORS[o.group_name] ?? 'bg-gray-50 text-gray-600 border-gray-200'
                  const deliveryStr = o.delivery_date?.slice(0, 10) ?? ''
                  const deliveryFmt = deliveryStr
                    ? (() => { const d = new Date(deliveryStr + 'T00:00:00'); return `${d.getMonth()+1}/${d.getDate()}` })()
                    : '—'
                  return (
                    <tr key={o.$id} className="hover:bg-gray-50 transition-colors">
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

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-xs text-gray-500">
              <span>{(page * PAGE_SIZE + 1).toLocaleString()}–{Math.min((page + 1) * PAGE_SIZE, filtered.length).toLocaleString()} / {filtered.length.toLocaleString()} 件</span>
              <div className="flex gap-1">
                <button onClick={() => setPage(0)}         disabled={page === 0}             className="px-2 py-1 border border-gray-200 rounded disabled:opacity-30">«</button>
                <button onClick={() => setPage(p => p-1)} disabled={page === 0}             className="px-2 py-1 border border-gray-200 rounded disabled:opacity-30">‹</button>
                <span className="px-3 py-1">{page + 1} / {totalPages}</span>
                <button onClick={() => setPage(p => p+1)} disabled={page >= totalPages - 1} className="px-2 py-1 border border-gray-200 rounded disabled:opacity-30">›</button>
                <button onClick={() => setPage(totalPages-1)} disabled={page >= totalPages - 1} className="px-2 py-1 border border-gray-200 rounded disabled:opacity-30">»</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}