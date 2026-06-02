'use client'

import { useEffect, useState, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { useStock } from '@/lib/stock-context'

// ── Types ────────────────────────────────────────────────────────────────────
interface Order {
  id: string
  order_no: string
  product_code: string
  product_name: string
  group_name: string
  lot_number: string
  delivery_date: string
  quantity: number
  weight_g: number
  status: string
}

interface ProductMaster {
  id: string
  product_code: string
  group_name: string
  group_key: string
  weight_g: number
  sort_order: number
  initial_stock: number | null
}

interface LotDef {
  id: string
  lot_id: string
  lot_label: string
  sort_order: number
}

interface ProductionPlan {
  id: string
  product_code: string
  week_start_date: string
  planned_quantity: number
}

// ── Constants ────────────────────────────────────────────────────────────────
const GROUP_COLORS: Record<string, { badge: string; header: string; row: string }> = {
  'M90S':   { badge: 'bg-blue-50 text-blue-700',     header: 'bg-blue-50/60',   row: 'bg-blue-50/20' },
  '300NP':  { badge: 'bg-green-50 text-green-700',   header: 'bg-green-50/60',  row: 'bg-green-50/20' },
  '100G20': { badge: 'bg-red-50 text-red-700',       header: 'bg-red-50/60',    row: 'bg-red-50/20' },
  '950X01': { badge: 'bg-purple-50 text-purple-700', header: 'bg-purple-50/60', row: 'bg-purple-50/20' },
}

const LOT_LABELS: Record<string, string> = {
  '1':'4／初〜','2':'4／末〜','3':'5／末〜','4':'6／中〜',
  '5':'7／末〜','6':'9／初〜','7':'10／初〜','8':'11／初〜',
  '9':'11／中〜','10':'12／中〜','国①':'1／中〜','国②':'2／初〜',
}

const LOT_ORDER   = ['1','2','3','4','5','6','7','8','9','10','国①','国②']
const GROUP_ORDER = ['M90S','300NP','100G20','950X01']

// ── Japanese holidays 2026–2027 ───────────────────────────────────────────────
const JP_HOLIDAYS = new Set([
  '2026-01-01','2026-01-12','2026-02-11','2026-02-23','2026-03-20',
  '2026-04-29','2026-05-03','2026-05-04','2026-05-05','2026-05-06',
  '2026-07-20','2026-08-11','2026-09-21','2026-09-22','2026-09-23',
  '2026-10-12','2026-11-03','2026-11-23','2026-12-23',
  '2027-01-01','2027-01-11','2027-02-11','2027-02-23','2027-03-21',
  '2027-04-29','2027-05-03','2027-05-04','2027-05-05',
  '2027-07-19','2027-08-11','2027-09-20','2027-09-23',
  '2027-10-11','2027-11-03','2027-11-23',
])

function isBusinessDay(dateStr: string): boolean {
  const d = new Date(dateStr + 'T00:00:00')
  const dow = d.getDay()
  if (dow === 0 || dow === 6) return false
  return !JP_HOLIDAYS.has(dateStr)
}

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function getMondayStr(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  const dow = d.getDay()
  const diff = dow === 0 ? -6 : 1 - dow
  d.setDate(d.getDate() + diff)
  return localDateStr(d)
}

function getWeekEndStr(mondayStr: string): string {
  for (let i = 4; i >= 0; i--) {
    const d = new Date(mondayStr + 'T00:00:00')
    d.setDate(d.getDate() + i)
    const s = localDateStr(d)
    if (isBusinessDay(s)) return s
  }
  return mondayStr
}

function toDateStr(val: any): string {
  if (!val) return ''
  if (typeof val === 'string') return val.slice(0, 10)
  if (val instanceof Date) {
    return val.getUTCFullYear() + '-' +
      String(val.getUTCMonth() + 1).padStart(2, '0') + '-' +
      String(val.getUTCDate()).padStart(2, '0')
  }
  if (val.value) return String(val.value).slice(0, 10)
  return String(val).slice(0, 10)
}
function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.getMonth() + 1}/${d.getDate()}`
}
function formatDateFull(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

function stockCellStyle(stock: number | null, shipQty: number): {
  cellBg: string; textColor: string; tooltip: string
} {
  if (stock === null) {
    return { cellBg: '', textColor: shipQty ? 'text-gray-800 font-medium' : 'text-gray-200', tooltip: '' }
  }
  if (stock < 0) {
    return { cellBg: 'bg-red-100', textColor: 'text-red-800 font-semibold', tooltip: `在庫不足: ${stock.toLocaleString()}` }
  }
  if (stock === 0 && shipQty > 0) {
    return { cellBg: 'bg-red-100', textColor: 'text-red-800 font-semibold', tooltip: '在庫切れ' }
  }
  return { cellBg: 'bg-green-50', textColor: shipQty ? 'text-gray-800 font-medium' : 'text-gray-400', tooltip: `残在庫: ${stock.toLocaleString()}` }
}

// ── generateWeeks: fixed frame 2026-04-01 to 2027-03-31 ──────────────────────
// Takes startDate string and number of weeks — always called with fixed args
function generateWeeks(startDate: string, numWeeks: number): string[] {
  const result: string[] = []
  let current = getMondayStr(startDate)
  for (let i = 0; i < numWeeks; i++) {
    result.push(current)
    const d = new Date(current + 'T00:00:00')
    d.setDate(d.getDate() + 7)
    current = localDateStr(d)
  }
  return result
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function ManufacturingPage() {
  const [orders,          setOrders]          = useState<Order[]>([])
  const [products,        setProducts]        = useState<ProductMaster[]>([])
  const [lots,            setLots]            = useState<LotDef[]>([])
  const [productionPlans, setProductionPlans] = useState<ProductionPlan[]>([])
  const [loading,         setLoading]         = useState(true)
  const [materialOrders,  setMaterialOrders]  = useState<any[]>([])

  const [filterGroup, setFilterGroup] = useState('')
  const [filterLot,   setFilterLot]   = useState('')
  const [showStock,   setShowStock]   = useState(true)

  const { setDailyStock } = useStock()

  async function fetchData() {
    setLoading(true)
    try {
      const [oRes, pRes, lRes, plRes, mRes] = await Promise.all([
        fetch('/api/orders?status=active').then(r => r.json()),
        fetch('/api/products').then(r => r.json()),
        fetch('/api/lots').then(r => r.json()),
        fetch('/api/production-plan').then(r => r.json()),
        fetch('/api/material-orders').then(r => r.json()),
      ])
      setOrders(oRes.data ?? [])
      setProducts(pRes.data ?? [])
      setLots(lRes.data ?? [])
      setProductionPlans(plRes.data ?? [])
      setMaterialOrders(mRes.data ?? [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [])

  const planMap = useMemo(() => {
    const map = new Map<string, Map<string, number>>()
    for (const p of productionPlans) {
      if (!map.has(p.product_code)) map.set(p.product_code, new Map())
      const weekKey = getMondayStr(p.week_start_date)
      map.get(p.product_code)!.set(weekKey, p.planned_quantity)
    }
    return map
  }, [productionPlans])

  const { productRows, dateCols, matrix } = useMemo(() => {
    const filteredOrders = orders.filter(o => {
      if (filterGroup && o.group_name !== filterGroup) return false
      if (filterLot   && o.lot_number  !== filterLot)  return false
      return true
    })

    const nameMap = new Map<string, string>()
    for (const o of orders) {
      if (o.product_name && !nameMap.has(o.product_code))
        nameMap.set(o.product_code, o.product_name)
    }

    // dateCols: all delivery dates from DB — past dates stay visible always
    const dateSet = new Set<string>()
    for (const o of filteredOrders) {
      const d = toDateStr(o.delivery_date)
      if (d) dateSet.add(d)
    }
    const dateCols = Array.from(dateSet).sort()

    const activeProductCodes = new Set(filteredOrders.map(o => o.product_code))
    const productRows = products
      .filter(p => activeProductCodes.has(p.product_code))
      .map(p => ({
        product_code:  p.product_code,
        group_name:    p.group_name,
        weight_g:      p.weight_g,
        sort_order:    p.sort_order,
        product_name:  nameMap.get(p.product_code) ?? '',
        initial_stock: p.initial_stock,
      }))
      .sort((a, b) => {
        const ga = GROUP_ORDER.indexOf(a.group_name)
        const gb = GROUP_ORDER.indexOf(b.group_name)
        if (ga !== gb) return ga - gb
        return a.sort_order - b.sort_order
      })

    const matrix = new Map<string, Map<string, number>>()
    for (const o of filteredOrders) {
      const d = toDateStr(o.delivery_date)
      if (!d || !o.product_code) continue
      if (!matrix.has(o.product_code)) matrix.set(o.product_code, new Map())
      const row = matrix.get(o.product_code)!
      row.set(d, (row.get(d) ?? 0) + (o.quantity ?? 0))
    }

    return { productRows, dateCols, matrix }
  }, [orders, products, filterGroup, filterLot])

  const effectivePlanMap = useMemo(() => {
    if (materialOrders.length === 0) return planMap

    const CONFIRMED = new Set(['confirmed', 'delivery_confirmed'])
    const GROUP_ORDER_LOCAL = ['M90S', '300NP', '100G20', '950X01']

    // Fixed start date — same frame as stock flow chart
    const firstWeek = getMondayStr('2026-04-01')

    const matBalance = new Map<string, number>()
    for (const g of GROUP_ORDER_LOCAL) {
      const init = materialOrders
        .filter((o: any) => o.status === 'initial_stock' && o.material_name === g)
        .sort((a: any, b: any) => toDateStr(b.delivery_date).localeCompare(toDateStr(a.delivery_date)))[0]
      const preConfirmed = materialOrders
        .filter((o: any) => o.material_name === g && CONFIRMED.has(o.status) &&
          getMondayStr(toDateStr(o.delivery_date)) < firstWeek)
        .reduce((s: number, o: any) => s + o.quantity_kg, 0)
      matBalance.set(g, (init?.quantity_kg ?? 0) + preConfirmed)
    }

    const arrivals = new Map<string, Map<string, number>>()
    for (const o of materialOrders) {
      if (!CONFIRMED.has(o.status)) continue
      const wk = getMondayStr(toDateStr(o.delivery_date))
      if (wk < firstWeek) continue
      if (!arrivals.has(wk)) arrivals.set(wk, new Map())
      arrivals.get(wk)!.set(o.material_name, (arrivals.get(wk)!.get(o.material_name) ?? 0) + o.quantity_kg)
    }

    const allWeeks = new Set<string>()
    for (const [, wMap] of planMap) for (const wk of wMap.keys()) allWeeks.add(wk)
    const sortedWeeks = Array.from(allWeeks).sort()

    const effective = new Map<string, Map<string, number>>()

    for (const weekStr of sortedWeeks) {
      for (const [g, kg] of (arrivals.get(weekStr) ?? new Map())) {
        matBalance.set(g, (matBalance.get(g) ?? 0) + kg)
      }

      const weekProducers = products
        .filter(p => planMap.get(p.product_code)?.has(weekStr) && p.weight_g)
        .sort((a, b) => a.sort_order - b.sort_order)

      for (const product of weekProducers) {
        const pc      = product.product_code
        const group   = product.group_name
        const wg      = product.weight_g ?? 0
        const planned = planMap.get(pc)?.get(weekStr) ?? 0
        if (planned === 0 || wg === 0) continue

        const needed     = (planned * wg) / 1000
        const available  = matBalance.get(group) ?? 0
        const executable = available >= needed ? planned : Math.floor((available * 1000) / wg)

        if (!effective.has(pc)) effective.set(pc, new Map())
        effective.get(pc)!.set(weekStr, executable)
        matBalance.set(group, Math.max(0, available - (executable * wg) / 1000))
      }
    }

    return effective
  }, [materialOrders, planMap, products])

  const stockMap = useMemo(() => {
    if (!showStock) return new Map<string, Map<string, number>>()

    const result = new Map<string, Map<string, number>>()

    for (const p of productRows) {
      if (p.initial_stock === null) continue

      const pStockMap = new Map<string, number>()
      const shipments = matrix.get(p.product_code)
      const pPlanMap  = effectivePlanMap.get(p.product_code) ?? planMap.get(p.product_code)

      let stock = p.initial_stock

      const allDates = new Set<string>(dateCols)
      if (pPlanMap) {
        for (const weekStart of pPlanMap.keys()) allDates.add(getWeekEndStr(weekStart))
      }

      const sortedDates = Array.from(allDates).sort()

      if (pPlanMap && sortedDates.length > 0) {
        const firstDate = sortedDates[0]
        for (const [weekStart, qty] of pPlanMap) {
          if (getWeekEndStr(weekStart) < firstDate) stock += qty
        }
      }

      for (const dateStr of sortedDates) {
        if (pPlanMap) {
          const mondayStr  = getMondayStr(dateStr)
          const weekEndStr = getWeekEndStr(mondayStr)
          if (dateStr === weekEndStr) stock += pPlanMap.get(mondayStr) ?? 0
        }
        stock -= shipments?.get(dateStr) ?? 0
        pStockMap.set(dateStr, stock)
      }

      result.set(p.product_code, pStockMap)
    }

    return result
  }, [productRows, dateCols, matrix, effectivePlanMap, planMap, showStock])

  function next5DaysShipments(productCode: string, dateStr: string): number {
    const shipments = matrix.get(productCode)
    if (!shipments) return 0
    const dateIdx = dateCols.indexOf(dateStr)
    let sum = 0, count = 0
    for (let i = dateIdx + 1; i < dateCols.length && count < 5; i++) {
      if (isBusinessDay(dateCols[i])) { sum += shipments.get(dateCols[i]) ?? 0; count++ }
    }
    return sum
  }

  function getCellStyle(productCode: string, dateStr: string, shipQty: number): {
    cellBg: string; textColor: string; tooltip: string
  } {
    if (!showStock) {
      return { cellBg: '', textColor: shipQty ? 'text-gray-800 font-medium' : 'text-gray-200', tooltip: '' }
    }
    const pStock = stockMap.get(productCode)
    if (!pStock) {
      return { cellBg: '', textColor: shipQty ? 'text-gray-800 font-medium' : 'text-gray-200', tooltip: '' }
    }
    const endOfDayStock = pStock.get(dateStr) ?? null
    if (endOfDayStock === null) {
      return { cellBg: '', textColor: shipQty ? 'text-gray-800 font-medium' : 'text-gray-200', tooltip: '' }
    }
    if (endOfDayStock < 0) {
      return { cellBg: 'bg-red-100', textColor: 'text-red-800 font-semibold', tooltip: `在庫不足 残: ${endOfDayStock.toLocaleString()}` }
    }
    const upcoming = next5DaysShipments(productCode, dateStr)
    if (endOfDayStock < upcoming) {
      return { cellBg: 'bg-yellow-50', textColor: shipQty ? 'text-yellow-800 font-medium' : 'text-yellow-600', tooltip: `残在庫: ${endOfDayStock.toLocaleString()} (5営業日分 ${upcoming.toLocaleString()} に不足)` }
    }
    return { cellBg: 'bg-green-50', textColor: shipQty ? 'text-gray-800 font-medium' : 'text-gray-400', tooltip: `残在庫: ${endOfDayStock.toLocaleString()}` }
  }

  const { lotCols, summaryProducts, pivotMatrix, groupTotals, grandTotals } = useMemo(() => {
    // lotCols: all LOTs that have orders — past LOTs stay visible
    const activeLotIds = new Set(orders.map(o => o.lot_number).filter(Boolean))
    const lotCols = lots.filter(l => activeLotIds.has(l.lot_id))

    const nameMap = new Map<string, string>()
    for (const o of orders) {
      if (o.product_name && !nameMap.has(o.product_code))
        nameMap.set(o.product_code, o.product_name)
    }

    const summaryProducts = products
      .map(p => ({
        product_code: p.product_code,
        group_name:   p.group_name,
        sort_order:   p.sort_order,
        product_name: nameMap.get(p.product_code) ?? '',
      }))
      .sort((a, b) => {
        const ga = GROUP_ORDER.indexOf(a.group_name)
        const gb = GROUP_ORDER.indexOf(b.group_name)
        if (ga !== gb) return ga - gb
        return a.sort_order - b.sort_order
      })

    const pivotMatrix = new Map<string, Map<string, number>>()
    for (const o of orders) {
      if (!o.lot_number || !o.product_code) continue
      if (!pivotMatrix.has(o.product_code)) pivotMatrix.set(o.product_code, new Map())
      const row = pivotMatrix.get(o.product_code)!
      row.set(o.lot_number, (row.get(o.lot_number) ?? 0) + (o.quantity ?? 0))
    }

    const groupTotals = new Map<string, Map<string, number>>()
    for (const g of GROUP_ORDER) {
      const gMap = new Map<string, number>()
      const gProducts = summaryProducts.filter(p => p.group_name === g)
      for (const l of lotCols) {
        const sum = gProducts.reduce((acc, p) => acc + (pivotMatrix.get(p.product_code)?.get(l.lot_id) ?? 0), 0)
        gMap.set(l.lot_id, sum)
      }
      groupTotals.set(g, gMap)
    }

    const grandTotals = new Map<string, number>()
    for (const l of lotCols) {
      const sum = Array.from(groupTotals.values()).reduce((acc, gMap) => acc + (gMap.get(l.lot_id) ?? 0), 0)
      grandTotals.set(l.lot_id, sum)
    }

    return { lotCols, summaryProducts, pivotMatrix, groupTotals, grandTotals }
  }, [orders, products, lots])

  // ── Stock flow: fixed frame 2026-04-01 to 2027-03-31 (52 weeks) ────────────
  const { flowWeeks, stockFlow } = useMemo(() => {
    // FIXED: always show from 2026-04-01 regardless of today's date
    const flowWeeks = generateWeeks('2026-04-01', 52)
    const firstWeek = flowWeeks[0]

    const CONFIRMED_STATUSES = ['delivery_confirmed', 'confirmed']

    const initialStock = new Map<string, number>()
    const initEntries  = materialOrders.filter((o: any) => o.status === 'initial_stock')
    for (const g of GROUP_ORDER) {
      const entries = initEntries
        .filter((o: any) => o.material_name === g)
        .sort((a: any, b: any) => toDateStr(b.delivery_date).localeCompare(toDateStr(a.delivery_date)))
      initialStock.set(g, entries.length > 0 ? entries[0].quantity_kg : 0)
    }

    const openingBalance = new Map<string, number>(
      GROUP_ORDER.map(g => [g, initialStock.get(g) ?? 0])
    )
    for (const o of materialOrders as any[]) {
      if (o.status === 'initial_stock') continue
      if (!CONFIRMED_STATUSES.includes(o.status)) continue
      const dateKey   = toDateStr(o.delivery_date)
      if (!dateKey) continue
      const weekStart = getMondayStr(dateKey)
      if (weekStart < firstWeek) {
        openingBalance.set(o.material_name, (openingBalance.get(o.material_name) ?? 0) + o.quantity_kg)
      }
    }

    const confirmedByWeek = new Map<string, Map<string, number>>()
    const pendingByWeek   = new Map<string, Map<string, number>>()

    for (const o of materialOrders as any[]) {
      if (o.status === 'initial_stock') continue
      const dateKey = toDateStr(o.delivery_date)
      if (!dateKey) continue
      const weekStart = getMondayStr(dateKey)
      if (CONFIRMED_STATUSES.includes(o.status) && weekStart < firstWeek) continue

      const isConfirmed = CONFIRMED_STATUSES.includes(o.status)
      const targetMap   = isConfirmed ? confirmedByWeek : pendingByWeek
      if (!targetMap.has(weekStart)) targetMap.set(weekStart, new Map())
      const wMap = targetMap.get(weekStart)!
      wMap.set(o.material_name, (wMap.get(o.material_name) ?? 0) + o.quantity_kg)
    }

    // Weekly consumption from production plans
    const weeklyConsumption = new Map<string, Map<string, number>>()
    const weightMap = new Map<string, number>()
    const groupMap  = new Map<string, string>()
    for (const p of products) {
      if (p.weight_g)   weightMap.set(p.product_code.trim(), p.weight_g)
      if (p.group_name) groupMap.set(p.product_code.trim(), p.group_name.trim())
    }
    for (const plan of productionPlans) {
      const code = plan.product_code.trim()
      const wg   = weightMap.get(code)
      const grp  = groupMap.get(code)
      if (!wg || !grp) continue
      const kgUsed      = (plan.planned_quantity * wg) / 1000
      const planWeekKey = getMondayStr(plan.week_start_date)
      if (!weeklyConsumption.has(planWeekKey)) weeklyConsumption.set(planWeekKey, new Map())
      const wMap = weeklyConsumption.get(planWeekKey)!
      wMap.set(grp, (wMap.get(grp) ?? 0) + kgUsed)
    }

    const stockFlow = new Map<string, {
      incoming: number; incomingPending: number; consumed: number; balance: number; shortfall: boolean
    }[]>()

    for (const g of GROUP_ORDER) {
      let balance = openingBalance.get(g) ?? 0
      const rows: { incoming: number; incomingPending: number; consumed: number; balance: number; shortfall: boolean }[] = []
      for (const weekStart of flowWeeks) {
        const incoming        = confirmedByWeek.get(weekStart)?.get(g) ?? 0
        const incomingPending = pendingByWeek.get(weekStart)?.get(g) ?? 0
        const consumed        = weeklyConsumption.get(weekStart)?.get(g) ?? 0
        balance -= consumed
        const shortfall = balance < 0
        balance += incoming
        rows.push({ incoming, incomingPending, consumed, balance, shortfall })
      }
      stockFlow.set(g, rows)
    }

    return { flowWeeks, stockFlow }
  }, [materialOrders, productionPlans, products])

  useEffect(() => {
    if (stockMap.size === 0) return
    setDailyStock({ byProduct: stockMap, calculatedAt: new Date() })
  }, [stockMap])

  function isGroupStart(rows: typeof productRows, idx: number): boolean {
    if (idx === 0) return true
    return rows[idx].group_name !== rows[idx - 1].group_name
  }

  function exportSummaryToExcel() {
    const headers = ['原料', '品番', '品名', ...lotCols.map(l => l.lot_label), '合計']
    const rows: any[][] = []
    for (const gname of GROUP_ORDER) {
      const gProducts = summaryProducts.filter(p => p.group_name === gname)
      for (const p of gProducts) {
        const rowData  = pivotMatrix.get(p.product_code)
        const lotVals  = lotCols.map(l => rowData?.get(l.lot_id) ?? 0)
        const rowTotal = lotVals.reduce((a, b) => a + b, 0)
        rows.push([gname, p.product_code, p.product_name, ...lotVals, rowTotal])
      }
    }
    const grandVals  = lotCols.map(l => grandTotals.get(l.lot_id) ?? 0)
    const grandTotal = grandVals.reduce((a, b) => a + b, 0)
    rows.push(['総合計', '', '', ...grandVals, grandTotal])
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '出荷納期サマリ')
    XLSX.writeFile(wb, `出荷納期サマリ_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  function balanceStyle(balance: number, shortfall: boolean): { bg: string; text: string } {
    if (shortfall || balance < 0) return { bg: 'bg-red-100',   text: 'text-red-800' }
    if (balance < 2000)           return { bg: 'bg-yellow-50', text: 'text-yellow-800' }
    return                               { bg: 'bg-green-50',  text: 'text-green-800' }
  }

  const groups           = ['', ...GROUP_ORDER]
  const lotFilterOptions = ['', ...LOT_ORDER]

  return (
    <div className="h-full overflow-auto p-6">

      {/* ══ SECTION 1: Daily Shipment Schedule ═══════════════════════════════ */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">出荷納期スケジュール</h2>
          <p className="text-sm text-gray-400 mt-0.5">
            {productRows.length} 品番 × {dateCols.length} 納期
          </p>
        </div>
        <button onClick={fetchData} className="text-sm text-blue-600 hover:text-blue-800 border border-blue-200 rounded-lg px-3 py-1.5">
          更新
        </button>
      </div>

      <div className="flex gap-3 mb-4 flex-wrap items-center">
        <select value={filterGroup} onChange={e => setFilterGroup(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-700 bg-white">
          {groups.map(g => <option key={g} value={g}>{g || '全グループ'}</option>)}
        </select>
        <select value={filterLot} onChange={e => setFilterLot(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-700 bg-white">
          {lotFilterOptions.map(l => (
            <option key={l} value={l}>{l ? `LOT ${l}　${LOT_LABELS[l] ?? ''}` : '全LOT'}</option>
          ))}
        </select>
        <button
          onClick={() => setShowStock(v => !v)}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm transition-colors ${
            showStock ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'
          }`}>
          <span className="text-xs">在庫カラー</span>
          <span className={`w-2 h-2 rounded-full ${showStock ? 'bg-blue-500' : 'bg-gray-300'}`} />
        </button>
        {showStock && (
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-100 border border-green-300" />在庫あり</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-yellow-100 border border-yellow-300" />5営業日以内に不足</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-100 border border-red-300" />在庫不足</span>
          </div>
        )}
      </div>

      {loading ? (
        <div className="text-center py-20 text-sm text-gray-400">読み込み中...</div>
      ) : productRows.length === 0 ? (
        <div className="text-center py-20 text-sm text-gray-400">表示できるデータがありません</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse" style={{ minWidth: 'max-content' }}>
              <thead className="sticky top-0 z-30">
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="sticky left-0 z-40 bg-gray-50 border-r border-gray-200 px-3 py-2.5 text-left font-medium text-gray-500 whitespace-nowrap min-w-[100px]">グループ</th>
                  <th className="sticky left-[100px] z-40 bg-gray-50 border-r border-gray-100 px-3 py-2.5 text-left font-medium text-gray-500 whitespace-nowrap min-w-[160px]">品番</th>
                  <th className="sticky left-[260px] z-40 bg-gray-50 border-r border-gray-200 px-3 py-2.5 text-left font-medium text-gray-500 whitespace-nowrap min-w-[160px]">品名</th>
                  {dateCols.map(d => (
                    <th key={d} className="px-2 py-2.5 text-center font-medium text-gray-500 whitespace-nowrap border-l border-gray-100 min-w-[64px]" title={formatDateFull(d)}>
                      {formatDate(d)}
                    </th>
                  ))}
                  <th className="px-3 py-2.5 text-right font-medium text-gray-500 whitespace-nowrap border-l border-gray-200 min-w-[72px]">合計</th>
                </tr>
              </thead>
              <tbody>
                {productRows.map((p, idx) => {
                  const gc       = GROUP_COLORS[p.group_name] ?? { badge: 'bg-gray-100 text-gray-600', header: 'bg-gray-50', row: '' }
                  const rowData  = matrix.get(p.product_code)
                  const rowTotal = rowData ? Array.from(rowData.values()).reduce((a, b) => a + b, 0) : 0
                  const showGroup = isGroupStart(productRows, idx)
                  return (
                    <>
                      {showGroup && (
                        <tr key={`sep-${p.group_name}`} className={gc.header}>
                          <td colSpan={3 + dateCols.length + 1} className="px-3 py-1.5 border-t border-b border-gray-200">
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${gc.badge}`}>{p.group_name}</span>
                            <span className="ml-2 text-gray-400 text-xs">
                              {productRows.filter(r => r.group_name === p.group_name).length} 品番
                            </span>
                          </td>
                        </tr>
                      )}
                      <tr key={p.product_code} className={`border-b border-gray-100 hover:brightness-95 transition-all ${gc.row}`}>
                        <td className="sticky left-0 z-10 bg-white border-r border-gray-200 px-3 py-2 whitespace-nowrap" style={{ boxShadow: '2px 0 6px -2px rgba(0,0,0,0.08)' }}>
                          {showGroup && <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${gc.badge}`}>{p.group_name}</span>}
                        </td>
                        <td className="sticky left-[100px] z-10 bg-white border-r border-gray-100 px-3 py-2 font-mono text-gray-600 whitespace-nowrap">
                          {p.product_code}
                        </td>
                        <td className="sticky left-[260px] z-10 bg-white border-r border-gray-200 px-3 py-2 text-gray-700 whitespace-nowrap max-w-[160px] truncate" style={{ boxShadow: '4px 0 10px -2px rgba(0,0,0,0.10)' }}>
                          {p.product_name || '—'}
                        </td>
                        {dateCols.map(d => {
                          const qty   = rowData?.get(d) ?? 0
                          const style = getCellStyle(p.product_code, d, qty)
                          return (
                            <td key={d} title={style.tooltip}
                              className={`px-2 py-2 text-right border-l border-gray-100 whitespace-nowrap tabular-nums transition-colors ${style.cellBg} ${style.textColor}`}>
                              {qty > 0 ? qty.toLocaleString() : '—'}
                            </td>
                          )
                        })}
                        <td className="px-3 py-2 text-right border-l border-gray-200 font-semibold text-gray-900 whitespace-nowrap tabular-nums">
                          {rowTotal > 0 ? rowTotal.toLocaleString() : '—'}
                        </td>
                      </tr>
                    </>
                  )
                })}
                <tr className="bg-gray-50 border-t-2 border-gray-300 font-semibold">
                  <td className="sticky left-0 z-10 bg-gray-50 border-r border-gray-200 px-3 py-2.5 text-gray-500 text-xs whitespace-nowrap" colSpan={3} style={{ boxShadow: '4px 0 10px -2px rgba(0,0,0,0.08)' }}>日別合計</td>
                  {dateCols.map(d => {
                    const colTotal = productRows.reduce((sum, p) => sum + (matrix.get(p.product_code)?.get(d) ?? 0), 0)
                    return (
                      <td key={d} className="px-2 py-2.5 text-right border-l border-gray-200 text-gray-800 tabular-nums whitespace-nowrap">
                        {colTotal > 0 ? colTotal.toLocaleString() : '—'}
                      </td>
                    )
                  })}
                  <td className="px-3 py-2.5 text-right border-l border-gray-300 text-gray-900 tabular-nums whitespace-nowrap">
                    {productRows.reduce((sum, p) => {
                      const r = matrix.get(p.product_code)
                      return sum + (r ? Array.from(r.values()).reduce((a, b) => a + b, 0) : 0)
                    }, 0).toLocaleString()}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══ SECTION 2: Material Stock Flow ═══════════════════════════════════ */}
      {!loading && (
        <div className="mt-12">
          <div className="mb-4">
            <h2 className="text-xl font-semibold text-gray-900">原材料在庫フロー</h2>
            <p className="text-sm text-gray-400 mt-0.5">2026年4月〜2027年3月 週次入荷・消費・残在庫</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="text-xs border-collapse" style={{ minWidth: 'max-content' }}>
                <thead className="sticky top-0 z-30">
                  <tr className="bg-gray-800 text-white">
                    <th className="sticky left-0 z-40 bg-gray-800 border-r border-gray-600 px-4 py-2.5 text-left font-medium whitespace-nowrap min-w-[100px]">原材料</th>
                    <th className="sticky left-[100px] z-40 bg-gray-800 border-r border-gray-600 px-3 py-2.5 text-left font-medium whitespace-nowrap min-w-[70px]">項目</th>
                    {flowWeeks.map(w => (
                      <th key={w} className="px-2 py-2.5 text-center font-medium whitespace-nowrap border-l border-gray-600 min-w-[90px]">
                        {(() => {
                          const end = getWeekEndStr(w)
                          const m1 = new Date(w + 'T00:00:00').getMonth() + 1
                          const d1 = new Date(w + 'T00:00:00').getDate()
                          const m2 = new Date(end + 'T00:00:00').getMonth() + 1
                          const d2 = new Date(end + 'T00:00:00').getDate()
                          return m1 === m2 ? `${m1}/${d1}–${d2}` : `${m1}/${d1}–${m2}/${d2}`
                        })()}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {GROUP_ORDER.map((g, gIdx) => {
                    const gs   = { badge: GROUP_COLORS[g]?.badge ?? 'bg-gray-100 text-gray-600' }
                    const rows = stockFlow.get(g) ?? []
                    const initKg = (materialOrders as any[])
                      .filter(o => o.status === 'initial_stock' && o.material_name === g)
                      .sort((a: any, b: any) => toDateStr(b.delivery_date).localeCompare(toDateStr(a.delivery_date)))[0]?.quantity_kg ?? 0
                    return (
                      <>
                        <tr key={`${g}-in`} className={`border-b border-gray-100 ${gIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}`}>
                          <td className="sticky left-0 z-10 bg-white border-r border-gray-100 px-4 py-2 whitespace-nowrap" rowSpan={3} style={{ boxShadow: '2px 0 6px -2px rgba(0,0,0,0.10)' }}>
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${gs.badge}`}>{g}</span>
                            <div className="text-[10px] text-gray-400 mt-1">初期: {initKg.toLocaleString()} kg</div>
                          </td>
                          <td className="sticky left-[100px] z-10 bg-white border-r border-gray-200 px-3 py-2 text-sky-600 font-medium whitespace-nowrap" style={{ boxShadow: '4px 0 10px -2px rgba(0,0,0,0.10)' }}>入荷 +</td>
                          {rows.map((r, i) => (
                            <td key={i} className="border-l border-gray-100 px-2 py-2 text-right tabular-nums">
                              {r.incoming > 0 && <span className="text-sky-700 font-medium">+{r.incoming.toLocaleString()}</span>}
                              {r.incomingPending > 0 && <span className={`text-sky-500 ${r.incoming > 0 ? 'block' : ''}`} style={{ opacity: 0.5 }} title="未確定">(+{r.incomingPending.toLocaleString()})</span>}
                              {r.incoming === 0 && r.incomingPending === 0 && <span className="text-gray-200">—</span>}
                            </td>
                          ))}
                        </tr>
                        <tr key={`${g}-out`} className={`border-b border-gray-100 ${gIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}`}>
                          <td className="sticky left-[100px] z-10 bg-white border-r border-gray-200 px-3 py-2 text-orange-600 font-medium whitespace-nowrap" style={{ boxShadow: '4px 0 10px -2px rgba(0,0,0,0.10)' }}>消費 −</td>
                          {rows.map((r, i) => (
                            <td key={i} className="border-l border-gray-100 px-2 py-2 text-right tabular-nums text-orange-700">
                              {r.consumed > 0 ? `−${Math.round(r.consumed).toLocaleString()}` : <span className="text-gray-200">—</span>}
                            </td>
                          ))}
                        </tr>
                        <tr key={`${g}-bal`} className={`border-b-2 border-gray-200 ${gIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}`}>
                          <td className="sticky left-[100px] z-10 bg-white border-r border-gray-200 px-3 py-2 font-bold text-gray-700 whitespace-nowrap" style={{ boxShadow: '4px 0 10px -2px rgba(0,0,0,0.10)' }}>残在庫</td>
                          {rows.map((r, i) => {
                            const style = balanceStyle(r.balance, r.shortfall)
                            return (
                              <td key={i} className={`border-l border-gray-100 px-2 py-2 text-right tabular-nums font-semibold ${style.bg} ${style.text}`}
                                title={r.shortfall ? '⚠️ 材料不足' : ''}>
                                {r.shortfall && <span className="mr-1">⚠️</span>}
                                {Math.round(r.balance).toLocaleString()} kg
                              </td>
                            )
                          })}
                        </tr>
                      </>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <div className="flex items-center gap-4 mt-2 text-xs text-gray-400 flex-wrap">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-50 border border-green-200 inline-block"/>充足</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-yellow-50 border border-yellow-200 inline-block"/>残少 (2,000kg未満)</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-100 border border-red-200 inline-block"/>不足 ⚠️</span>
          </div>
        </div>
      )}

      {/* ══ SECTION 3: LOT Summary ════════════════════════════════════════════ */}
      {!loading && summaryProducts.length > 0 && (
        <div className="mt-12">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">出荷納期サマリ</h2>
              <p className="text-sm text-gray-400 mt-0.5">手配LOT期間ごとの出荷数量合計</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-400 bg-gray-100 px-3 py-1 rounded-full">
                {summaryProducts.length} 品番 × {lotCols.length} LOT期間
              </span>
              <button onClick={exportSummaryToExcel}
                className="text-sm text-green-700 hover:text-green-900 border border-green-300 bg-green-50 hover:bg-green-100 rounded-lg px-3 py-1.5 transition-colors">
                Excel 出力
              </button>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="text-xs border-collapse" style={{ minWidth: 'max-content' }}>
                <thead>
                  <tr className="bg-gray-800 text-white">
                    <th className="px-3 py-2.5 text-left font-medium border-r border-gray-600 whitespace-nowrap min-w-[100px]">原料</th>
                    <th className="px-3 py-2.5 text-left font-medium border-r border-gray-600 whitespace-nowrap min-w-[160px]">品番</th>
                    <th className="px-3 py-2.5 text-left font-medium border-r border-gray-600 whitespace-nowrap min-w-[140px]">品名</th>
                    {lotCols.map(l => (
                      <th key={l.lot_id} className="px-2 py-2.5 text-center font-medium border-r border-gray-600 whitespace-nowrap min-w-[72px]">
                        {l.lot_label}
                      </th>
                    ))}
                    <th className="px-3 py-2.5 text-center font-semibold bg-gray-900 whitespace-nowrap min-w-[72px]">合計</th>
                  </tr>
                </thead>
                <tbody>
                  {GROUP_ORDER.map(gname => {
                    const gc        = GROUP_COLORS[gname] ?? { badge: 'bg-gray-100 text-gray-600', row: '' }
                    const gProducts = summaryProducts.filter(p => p.group_name === gname)
                    if (gProducts.length === 0) return null
                    return (
                      <>
                        {gProducts.map((p, idx) => {
                          const rowData  = pivotMatrix.get(p.product_code)
                          const rowTotal = rowData ? Array.from(rowData.values()).reduce((a, b) => a + b, 0) : 0
                          return (
                            <tr key={p.product_code} className={`border-b border-gray-100 hover:brightness-95 ${idx % 2 === 0 ? 'bg-white' : gc.row}`}>
                              <td className="px-3 py-2 border-r border-gray-100 whitespace-nowrap">
                                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${gc.badge}`}>{gname}</span>
                              </td>
                              <td className="px-3 py-2 font-mono text-gray-600 border-r border-gray-100 whitespace-nowrap">{p.product_code}</td>
                              <td className="px-3 py-2 text-gray-500 border-r border-gray-100 whitespace-nowrap max-w-[140px] truncate">{p.product_name || '—'}</td>
                              {lotCols.map(l => {
                                const val = rowData?.get(l.lot_id) ?? 0
                                return (
                                  <td key={l.lot_id} className="px-3 py-2 text-right border-r border-gray-100 tabular-nums whitespace-nowrap">
                                    {val > 0 ? <span className="text-gray-700 font-medium">{val.toLocaleString()}</span> : <span className="text-gray-300">—</span>}
                                  </td>
                                )
                              })}
                              <td className="px-3 py-2 text-right font-semibold text-gray-800 bg-gray-50 tabular-nums whitespace-nowrap">
                                {rowTotal > 0 ? rowTotal.toLocaleString() : '—'}
                              </td>
                            </tr>
                          )
                        })}
                      </>
                    )
                  })}
                  <tr className="bg-gray-900 text-white">
                    <td colSpan={3} className="px-3 py-3 font-bold border-r border-gray-700 whitespace-nowrap">総合計</td>
                    {lotCols.map(l => {
                      const val = grandTotals.get(l.lot_id) ?? 0
                      return (
                        <td key={l.lot_id} className="px-3 py-3 text-right font-bold border-r border-gray-700 tabular-nums whitespace-nowrap">
                          {val > 0 ? val.toLocaleString() : '—'}
                        </td>
                      )
                    })}
                    <td className="px-3 py-3 text-right font-bold tabular-nums bg-black/30 whitespace-nowrap">
                      {Array.from(grandTotals.values()).reduce((a, b) => a + b, 0).toLocaleString()}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}