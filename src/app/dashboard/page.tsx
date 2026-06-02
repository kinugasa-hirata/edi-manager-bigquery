'use client'

import { useEffect, useState, useMemo } from 'react'
import * as XLSX from 'xlsx'

interface Order {
  id: string
  product_code: string
  product_name: string
  group_name: string
  lot_number: string
  mfg_lot_no: string
  delivery_date: string
  quantity: number
  order_date?: string
}
interface ProductMaster {
  id: string
  product_code: string
  group_name: string
  weight_g: number | null
  sort_order: number
  initial_stock: number | null
}
interface ProductionPlan {
  id: string
  product_code: string
  week_start_date: string
  planned_quantity: number
}
interface LotDef {
  id: string
  lot_id: string
  lot_label: string
  start_from: string
  sort_order: number
}
interface MaterialOrder {
  id: string
  material_name: string
  quantity_kg: number
  delivery_date: string
  status: string
}

const GROUP_ORDER = ['M90S', '300NP', '100G20', '950X01']
const GROUP_COLORS: Record<string, { badge: string; row: string }> = {
  'M90S':   { badge: 'bg-blue-50 text-blue-700',     row: 'bg-blue-50/30' },
  '300NP':  { badge: 'bg-green-50 text-green-700',   row: 'bg-green-50/30' },
  '100G20': { badge: 'bg-red-50 text-red-700',       row: 'bg-red-50/30' },
  '950X01': { badge: 'bg-purple-50 text-purple-700', row: 'bg-purple-50/30' },
}

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

function isBusinessDay(s: string): boolean {
  const d = new Date(s + 'T00:00:00')
  if (d.getDay() === 0 || d.getDay() === 6) return false
  return !JP_HOLIDAYS.has(s)
}

function addDays(s: string, n: number): string {
  const d = new Date(s + 'T00:00:00')
  d.setDate(d.getDate() + n)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

function getMondayStr(s: string): string {
  const d = new Date(s + 'T00:00:00')
  const diff = d.getDay() === 0 ? -6 : 1 - d.getDay()
  d.setDate(d.getDate() + diff)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function lotCoverageStyle(stock: number | null, demand: number): { bg: string; text: string; label: string } {
  if (stock === null || demand === 0) return { bg: '', text: 'text-gray-700', label: '' }
  if (stock <= 0)     return { bg: 'bg-red-100',    text: 'text-red-800',    label: '在庫なし' }
  const r = stock / demand
  if (r >= 1)   return { bg: 'bg-green-100',  text: 'text-green-800',  label: '充足' }
  if (r >= 0.8) return { bg: 'bg-yellow-100', text: 'text-yellow-800', label: '不足20%未満' }
  if (r >= 0.5) return { bg: 'bg-orange-100', text: 'text-orange-800', label: '不足50%未満' }
  return              { bg: 'bg-red-100',    text: 'text-red-800',    label: '大幅不足' }
}

// ── Order Date Summary ────────────────────────────────────────────────────────
function OrderDateSummary({ orders }: { orders: Order[] }) {
  const [open, setOpen] = useState(true)

  const grouped = useMemo(() => {
    const map = new Map<string, number>()
    for (const o of orders) {
      const d = o.order_date ?? '不明'
      map.set(d, (map.get(d) ?? 0) + 1)
    }
    return Array.from(map.entries()).sort((a, b) => {
      if (a[0] === '不明') return 1
      if (b[0] === '不明') return -1
      return b[0].localeCompare(a[0])
    })
  }, [orders])

  const total = orders.filter(o => o.order_date).length

  return (
    <div className="mt-8">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between mb-2 group">
        <div className="flex items-center gap-2">
          <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <h2 className="text-sm font-semibold text-gray-700">注文履歴</h2>
          <span className="text-xs text-gray-400">{grouped.length}日分 / {total.toLocaleString()}件</span>
        </div>
        <span className="text-xs text-gray-400 group-hover:text-gray-600">{open ? '折りたたむ' : '展開する'}</span>
      </button>

      {open && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100 text-gray-400">
                <th className="px-4 py-2 text-left font-normal">注文年月日</th>
                <th className="px-4 py-2 text-right font-normal">発注件数</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {grouped.map(([date, count]) => (
                <tr key={date} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-gray-700 font-mono">{date}</td>
                  <td className="px-4 py-2 text-right text-gray-700 tabular-nums font-medium">{count.toLocaleString()} 件</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [orders,         setOrders]         = useState<Order[]>([])
  const [products,       setProducts]       = useState<ProductMaster[]>([])
  const [lots,           setLots]           = useState<LotDef[]>([])
  const [productionPlan, setProductionPlan] = useState<ProductionPlan[]>([])
  const [materialOrders, setMaterialOrders] = useState<MaterialOrder[]>([])
  const [loading,        setLoading]        = useState(true)
  const [error,          setError]          = useState('')

  // ── Fetch all needed data from Appwrite ────────────────────────────────────
  // Includes materialOrders so feasibility check can mirror mfg-lot page.
  // Each call always goes to Appwrite — no local cache — so refreshing always
  // picks up the latest production plan edits from any user/session.
  async function fetchData() {
    setLoading(true)
    setError('')
    try {
      const [oRows, pRows, lRows, ppRows, mRows] = await Promise.all([
        fetch('/api/orders?status=active').then(r => r.json()),
        fetch('/api/products').then(r => r.json()),
        fetch('/api/lots').then(r => r.json()),
        fetch('/api/production-plan').then(r => r.json()),
        fetch('/api/material-orders').then(r => r.json()),
      ])
      setOrders(oRows.data ?? [])
      setProducts(pRows.data ?? [])
      setLots(lRows.data ?? [])
      setProductionPlan(ppRows.data ?? [])
      setMaterialOrders(mRows.data ?? [])
    } catch (e: any) {
      setError(e?.message ?? '読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [])

  const nameMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const o of orders) {
      if (o.product_name && !m.has(o.product_code)) m.set(o.product_code, o.product_name)
    }
    return m
  }, [orders])

  const activeLots = useMemo(() => {
    const active = new Set(orders.map(o => o.lot_number).filter(Boolean))
    return lots.filter(l => active.has(l.lot_id))
  }, [lots, orders])

  const sortedProducts = useMemo(() =>
    [...products].sort((a, b) => {
      const ga = GROUP_ORDER.indexOf(a.group_name)
      const gb = GROUP_ORDER.indexOf(b.group_name)
      if (ga !== gb) return ga - gb
      return a.sort_order - b.sort_order
    }), [products])

  const pivotMatrix = useMemo(() => {
    const m = new Map<string, Map<string, number>>()
    for (const o of orders) {
      if (!o.lot_number || !o.product_code) continue
      if (!m.has(o.product_code)) m.set(o.product_code, new Map())
      const row = m.get(o.product_code)!
      row.set(o.lot_number, (row.get(o.lot_number) ?? 0) + o.quantity)
    }
    return m
  }, [orders])

  const grandTotals = useMemo(() => {
    const m = new Map<string, number>()
    for (const lot of activeLots) {
      const sum = sortedProducts.reduce(
        (acc, p) => acc + (pivotMatrix.get(p.product_code)?.get(lot.lot_id) ?? 0), 0
      )
      m.set(lot.lot_id, sum)
    }
    return m
  }, [sortedProducts, activeLots, pivotMatrix])

  // ── Feasibility-constrained effective plan ─────────────────────────────────
  // Mirrors the greedy material allocation logic in mfg-lot/page.tsx exactly.
  // Only production that can be covered by confirmed/delivery_confirmed/initial_stock
  // material is counted. Unfeasible weeks are set to 0 — same as mfg-lot page.
  // This ensures the dashboard color map matches the mfg-lot cascade view.
  const feasiblePlanMap = useMemo(() => {
    const CONFIRMED = new Set(['confirmed', 'delivery_confirmed', 'initial_stock'])

    // Total material pool per group (all confirmed across all time — same as mfg-lot page)
    const groupMaterialPool = new Map<string, number>()
    for (const g of GROUP_ORDER) {
      groupMaterialPool.set(g, materialOrders
        .filter(mo => mo.material_name === g && CONFIRMED.has(mo.status))
        .reduce((s, mo) => s + mo.quantity_kg, 0))
    }

    // Weight / group lookup
    const weightMap = new Map<string, number>()
    const groupMap  = new Map<string, string>()
    for (const p of products) {
      if (p.weight_g)   weightMap.set(p.product_code.trim(), p.weight_g)
      if (p.group_name) groupMap.set(p.product_code.trim(), p.group_name.trim())
    }

    // All weeks in production plan, sorted
    const allWeeks = Array.from(new Set(productionPlan.map(pp => pp.week_start_date.slice(0, 10)))).sort()
    const materialUsed = new Map<string, number>()
    for (const g of GROUP_ORDER) materialUsed.set(g, 0)

    const effective = new Map<string, Map<string, number>>()

    for (const wk of allWeeks) {
      // Greedy: products in group/sort_order order, same as mfg-lot page
      const wkPlans = productionPlan
        .filter(pp => pp.week_start_date.slice(0, 10) === wk)
        .sort((a, b) => {
          const pa = products.find(pr => pr.product_code === a.product_code)
          const pb = products.find(pr => pr.product_code === b.product_code)
          return (pa?.sort_order ?? 999) - (pb?.sort_order ?? 999)
        })

      for (const pp of wkPlans) {
        const pc    = pp.product_code.trim()
        const group = groupMap.get(pc) ?? ''
        const wg    = weightMap.get(pc) ?? 0
        if (!group || wg === 0 || pp.planned_quantity === 0) continue

        const needed     = (pp.planned_quantity * wg) / 1000
        const pool       = groupMaterialPool.get(group) ?? 0
        const used       = materialUsed.get(group) ?? 0
        const executable = used + needed <= pool ? pp.planned_quantity : 0

        if (executable > 0) {
          materialUsed.set(group, used + needed)
          if (!effective.has(pp.product_code)) effective.set(pp.product_code, new Map())
          effective.get(pp.product_code)!.set(wk, executable)
        }
        // executable === 0 → unfeasible, not added → not counted in stock
      }
    }

    return effective
  }, [materialOrders, productionPlan, products])

  // ── LOT stock map using feasible production only ───────────────────────────
  // Production arrives on Friday of its week (Monday + 4 days), same as dashboard
  // logic before — but now uses feasiblePlanMap instead of raw productionPlan.
  const lotStockMap = useMemo(() => {
    const result = new Map<string, Map<string, number>>()

    for (const p of sortedProducts) {
      const initialStock = p.initial_stock ?? 0

      // Only feasible production entries (material-constrained)
      const feasibleWeeks = feasiblePlanMap.get(p.product_code) ?? new Map<string, number>()
      const productions = Array.from(feasibleWeeks.entries()).map(([weekStart, qty]) => ({
        arriveDate: addDays(weekStart, 4),  // Friday of the week
        qty,
      }))

      // Total demand per lot_id
      const demandByLot = new Map<string, number>()
      for (const o of orders) {
        if (o.product_code !== p.product_code || !o.lot_number) continue
        demandByLot.set(o.lot_number, (demandByLot.get(o.lot_number) ?? 0) + o.quantity)
      }

      const pLotMap = new Map<string, number>()
      let runningStock = initialStock
      const usedProduction = new Set<string>()

      for (let li = 0; li < activeLots.length; li++) {
        const lot      = activeLots[li]
        const lotStart = lot.start_from ? String(lot.start_from).slice(0, 10) : ''
        const lotEnd   = li + 1 < activeLots.length
          ? String(activeLots[li + 1].start_from).slice(0, 10)
          : '2099-12-31'

        // Fold in feasible production arriving BEFORE this LOT starts
        for (const pr of productions) {
          const key = `${pr.arriveDate}_${pr.qty}`
          if (!usedProduction.has(key) && pr.arriveDate < lotStart) {
            runningStock += pr.qty
            usedProduction.add(key)
          }
        }

        // Opening stock for this LOT (used for color coding)
        pLotMap.set(lot.lot_id, runningStock)

        // Deduct this LOT's demand
        runningStock -= demandByLot.get(lot.lot_id) ?? 0

        // Fold in feasible production arriving DURING this LOT period
        for (const pr of productions) {
          const key = `${pr.arriveDate}_${pr.qty}`
          if (!usedProduction.has(key) && pr.arriveDate >= lotStart && pr.arriveDate < lotEnd) {
            runningStock += pr.qty
            usedProduction.add(key)
          }
        }
      }

      result.set(p.product_code, pLotMap)
    }
    return result
  }, [sortedProducts, activeLots, orders, feasiblePlanMap])

  function exportToExcel() {
    const headers = ['原料', '品番', '品名', ...activeLots.map(l => l.lot_label), '合計']
    const rows: any[][] = []
    for (const gname of GROUP_ORDER) {
      for (const p of sortedProducts.filter(p => p.group_name === gname)) {
        const rowData = pivotMatrix.get(p.product_code)
        const lotVals = activeLots.map(l => rowData?.get(l.lot_id) ?? 0)
        rows.push([gname, p.product_code, nameMap.get(p.product_code) ?? '',
          ...lotVals, lotVals.reduce((a, b) => a + b, 0)])
      }
    }
    const grandVals = activeLots.map(l => grandTotals.get(l.lot_id) ?? 0)
    rows.push(['総合計', '', '', ...grandVals, grandVals.reduce((a, b) => a + b, 0)])
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '出荷納期サマリ')
    XLSX.writeFile(wb, `出荷納期サマリ_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  return (
    <div className="h-full overflow-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">ダッシュボード</h1>
          <p className="text-sm text-gray-400 mt-0.5">出荷納期サマリ — LOT別出荷数量</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={fetchData}
            className="text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5">
            更新
          </button>
          {!loading && !error && (
            <button onClick={exportToExcel}
              className="text-sm font-medium text-green-700 border border-green-300 bg-green-50 hover:bg-green-100 rounded-lg px-4 py-1.5 transition-colors">
              Excel 出力
            </button>
          )}
        </div>
      </div>

      {/* KPI cards */}
      {!loading && !error && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
            <p className="text-xs text-gray-400 mb-1">受注件数</p>
            <p className="text-2xl font-bold text-gray-900">{orders.length.toLocaleString()}</p>
            <p className="text-xs text-gray-400 mt-0.5">件</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
            <p className="text-xs text-gray-400 mb-1">管理品番数</p>
            <p className="text-2xl font-bold text-gray-900">{sortedProducts.length}</p>
            <p className="text-xs text-gray-400 mt-0.5">品番</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
            <p className="text-xs text-gray-400 mb-1">総出荷数量</p>
            <p className="text-2xl font-bold text-gray-900">
              {orders.reduce((s, o) => s + o.quantity, 0).toLocaleString()}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">個</p>
          </div>
        </div>
      )}

      {/* Legend */}
      {!loading && !error && (
        <div className="flex items-center gap-4 mb-4 text-xs flex-wrap">
          <span className="text-gray-500">在庫カバレッジ（確定製造のみ計算）:</span>
          <span className="flex items-center gap-1.5 text-gray-500">
            <span className="w-3 h-3 rounded bg-green-100 border border-green-300 inline-block"/>充足 (100%以上)
          </span>
          <span className="flex items-center gap-1.5 text-gray-500">
            <span className="w-3 h-3 rounded bg-yellow-100 border border-yellow-300 inline-block"/>不足20%未満
          </span>
          <span className="flex items-center gap-1.5 text-gray-500">
            <span className="w-3 h-3 rounded bg-orange-100 border border-orange-300 inline-block"/>不足50%未満
          </span>
          <span className="flex items-center gap-1.5 text-gray-500">
            <span className="w-3 h-3 rounded bg-red-100 border border-red-300 inline-block"/>大幅不足
          </span>
        </div>
      )}

      {/* Main table */}
      {loading ? (
        <div className="text-center py-20 text-sm text-gray-400">読み込み中...</div>
      ) : error ? (
        <div className="text-center py-20">
          <p className="text-sm text-red-500 mb-3">{error}</p>
          <button onClick={fetchData} className="text-sm text-blue-600 border border-blue-200 rounded-lg px-4 py-2">再試行</button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse" style={{ minWidth: 'max-content' }}>
              <thead className="sticky top-0 z-30">
                <tr className="bg-gray-800 text-white">
                  <th className="sticky left-0 z-40 bg-gray-800 px-3 py-2.5 text-left font-medium border-r border-gray-600 whitespace-nowrap min-w-[90px]">原料</th>
                  <th className="sticky left-[90px] z-40 bg-gray-800 px-3 py-2.5 text-left font-medium border-r border-gray-600 whitespace-nowrap min-w-[160px]">品番</th>
                  <th className="sticky left-[250px] z-40 bg-gray-800 px-3 py-2.5 text-left font-medium border-r border-gray-600 whitespace-nowrap min-w-[130px]">品名</th>
                  {activeLots.map(l => (
                    <th key={l.lot_id} className="px-2 py-2.5 text-center font-medium border-r border-gray-600 whitespace-nowrap min-w-[90px]">
                      <div>{l.lot_label}</div>
                      <div className="text-[10px] opacity-50 font-normal">
                        {(() => { const d = new Date(String(l.start_from).slice(0,10) + 'T00:00:00'); return `${d.getMonth()+1}/${d.getDate()}`; })()}〜
                      </div>
                    </th>
                  ))}
                  <th className="px-3 py-2.5 text-center font-semibold bg-gray-900 whitespace-nowrap min-w-[80px]">合計</th>
                </tr>
              </thead>
              <tbody>
                {GROUP_ORDER.map(gname => {
                  const gc     = GROUP_COLORS[gname] ?? { badge: 'bg-gray-100 text-gray-600', row: '' }
                  const gProds = sortedProducts.filter(p => p.group_name === gname)
                  if (gProds.length === 0) return null
                  return gProds.map((p, idx) => {
                    const rowData   = pivotMatrix.get(p.product_code)
                    const rowTotal  = rowData ? Array.from(rowData.values()).reduce((a, b) => a + b, 0) : 0
                    const pLotStock = lotStockMap.get(p.product_code)

                    return (
                      <tr key={p.product_code}
                        className={`border-b border-gray-100 hover:brightness-95 transition-all ${idx % 2 === 0 ? 'bg-white' : gc.row}`}>
                        <td className="sticky left-0 z-10 bg-white px-3 py-2 border-r border-gray-100 whitespace-nowrap"
                          style={{ boxShadow: '2px 0 6px -2px rgba(0,0,0,0.08)' }}>
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${gc.badge}`}>{gname}</span>
                        </td>
                        <td className="sticky left-[90px] z-10 bg-white px-3 py-2 font-mono text-gray-600 border-r border-gray-100 whitespace-nowrap">
                          {p.product_code}
                        </td>
                        <td className="sticky left-[250px] z-10 bg-white px-3 py-2 text-gray-500 border-r border-gray-100 whitespace-nowrap max-w-[130px] truncate"
                          style={{ boxShadow: '4px 0 10px -2px rgba(0,0,0,0.10)' }}>
                          {nameMap.get(p.product_code) ?? '—'}
                        </td>
                        {activeLots.map(l => {
                          const demand = rowData?.get(l.lot_id) ?? 0
                          const stock  = pLotStock?.get(l.lot_id) ?? null
                          const style  = lotCoverageStyle(stock, demand)

                          return (
                            <td key={l.lot_id}
                              className={`px-3 py-2 text-right border-r border-gray-100 tabular-nums whitespace-nowrap transition-colors ${style.bg} ${style.text}`}
                              title={stock !== null
                                ? `LOT前在庫: ${stock.toLocaleString()} / 出荷需要: ${demand.toLocaleString()}${style.label ? ` — ${style.label}` : ''}`
                                : demand > 0 ? '初期在庫未設定' : ''}>
                              {demand > 0
                                ? <span className="font-medium">{demand.toLocaleString()}</span>
                                : <span className="text-gray-300">—</span>
                              }
                            </td>
                          )
                        })}
                        <td className="px-3 py-2 text-right font-semibold text-gray-800 bg-gray-50 tabular-nums whitespace-nowrap">
                          {rowTotal > 0 ? rowTotal.toLocaleString() : '—'}
                        </td>
                      </tr>
                    )
                  })
                })}
                <tr className="bg-gray-900 text-white border-t-2 border-gray-400">
                  <td colSpan={3} className="sticky left-0 z-10 bg-gray-900 px-3 py-3 font-bold border-r border-gray-700">総合計</td>
                  {activeLots.map(l => (
                    <td key={l.lot_id} className="px-3 py-3 text-right font-bold border-r border-gray-700 tabular-nums">
                      {(grandTotals.get(l.lot_id) ?? 0) > 0
                        ? (grandTotals.get(l.lot_id) ?? 0).toLocaleString()
                        : '—'}
                    </td>
                  ))}
                  <td className="px-3 py-3 text-right font-bold tabular-nums bg-black/30">
                    {Array.from(grandTotals.values()).reduce((a, b) => a + b, 0).toLocaleString()}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Order history */}
      {!loading && orders.length > 0 && (
        <OrderDateSummary orders={orders} />
      )}
    </div>
  )
}