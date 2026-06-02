'use client'

import { useEffect, useState, useMemo } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────
interface Order {
  id: string
  product_code: string
  product_name: string
  group_name: string
  mfg_lot_no: string
  delivery_date: string
  quantity: number
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

interface MaterialOrder {
  id: string
  material_name: string
  quantity_kg: number
  delivery_date: string
  status: string
  trading_company: string | null
}

// ── BigQuery date helper ───────────────────────────────────────────────────
function toDateStr(val: any): string {
  if (!val) return ''
  if (typeof val === 'string') return val.slice(0, 10)
  if (val instanceof Date) {
    const y = val.getUTCFullYear()
    const m = String(val.getUTCMonth() + 1).padStart(2, '0')
    const d = String(val.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  if (val.value) return String(val.value).slice(0, 10)
  return String(val).slice(0, 10)
}

const GROUP_ORDER = ['M90S', '300NP', '100G20', '950X01']
const GROUP_COLORS: Record<string, { badge: string; header: string }> = {
  'M90S':   { badge: 'bg-blue-50 text-blue-700',     header: 'bg-blue-800' },
  '300NP':  { badge: 'bg-green-50 text-green-700',   header: 'bg-green-800' },
  '100G20': { badge: 'bg-red-50 text-red-700',       header: 'bg-red-800' },
  '950X01': { badge: 'bg-purple-50 text-purple-700', header: 'bg-purple-800' },
}

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function getMondayStr(s: string): string {
  const d = new Date(s + 'T00:00:00')
  const diff = d.getDay() === 0 ? -6 : 1 - d.getDay()
  d.setDate(d.getDate() + diff)
  return localDateStr(d)
}
// Get the Friday (or last business day) of a week given its Monday
function getWeekEndStr(monday: string): string {
  const d = new Date(monday + 'T00:00:00')
  d.setDate(d.getDate() + 4) // Friday
  return localDateStr(d)
}
function generateWeeks(startDate: string, weeks: number): string[] {
  const result: string[] = []
  let current = getMondayStr(startDate)
  for (let i = 0; i < weeks; i++) {
    result.push(current)
    const d = new Date(current + 'T00:00:00'); d.setDate(d.getDate() + 7); current = localDateStr(d)
  }
  return result
}
function fmtDate(s: string | null): string {
  if (!s) return '—'
  const d = new Date(s + 'T00:00:00')
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export default function AllocationPage() {
  const [orders,         setOrders]         = useState<Order[]>([])
  const [products,       setProducts]       = useState<ProductMaster[]>([])
  const [materialOrders, setMaterialOrders] = useState<MaterialOrder[]>([])
  const [plans,          setPlans]          = useState<ProductionPlan[]>([])
  const [loading,        setLoading]        = useState(true)
  const [error,          setError]          = useState('')

  const [expandedGroups,   setExpandedGroups]   = useState<Set<string>>(new Set())
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set())

  async function fetchData() {
    setLoading(true); setError('')
    try {
      const [oRes, pRes, mRes, plRes] = await Promise.all([
        fetch('/api/orders?status=active').then(r => r.json()),
        fetch('/api/products').then(r => r.json()),
        fetch('/api/material-orders').then(r => r.json()),
        fetch('/api/production-plan').then(r => r.json()),
      ])
      setOrders(oRes.data ?? [])
      setProducts(pRes.data ?? [])
      setMaterialOrders(mRes.data ?? [])
      setPlans(plRes.data ?? [])
    } catch (e: any) {
      setError(e?.message ?? '読み込みに失敗しました')
    } finally { setLoading(false) }
  }

  useEffect(() => { fetchData() }, [])

  const materialFinalBalance = useMemo(() => {
    const CONFIRMED_M = new Set(['confirmed', 'delivery_confirmed'])
    const flowWeeks   = generateWeeks('2026-04-01', 52)
    const firstWeek   = flowWeeks[0]
    const weightMap   = new Map<string, number>()
    const groupMapL   = new Map<string, string>()
    for (const p of products) {
      if (p.weight_g)   weightMap.set(p.product_code, p.weight_g)
      if (p.group_name) groupMapL.set(p.product_code, p.group_name)
    }
    const weeklyConsumption = new Map<string, Map<string, number>>()
    for (const plan of plans) {
      const wg  = weightMap.get(plan.product_code); const grp = groupMapL.get(plan.product_code)
      if (!wg || !grp) continue
      const kgUsed  = (plan.planned_quantity * wg) / 1000
      const weekKey = getMondayStr(toDateStr(plan.week_start_date))
      if (!weeklyConsumption.has(weekKey)) weeklyConsumption.set(weekKey, new Map())
      const wm = weeklyConsumption.get(weekKey)!
      wm.set(grp, (wm.get(grp) ?? 0) + kgUsed)
    }
    const openingBalance = new Map<string, number>()
    for (const g of GROUP_ORDER) {
      const initE = materialOrders.filter(o => o.material_name === g && o.status === 'initial_stock')
        .sort((a, b) => toDateStr(b.delivery_date).localeCompare(toDateStr(a.delivery_date)))
      openingBalance.set(g, initE[0]?.quantity_kg ?? 0)
    }
    for (const mo of materialOrders) {
      if (mo.status === 'initial_stock' || !CONFIRMED_M.has(mo.status)) continue
      const weekStart = getMondayStr(toDateStr(mo.delivery_date))
      if (weekStart < firstWeek)
        openingBalance.set(mo.material_name, (openingBalance.get(mo.material_name) ?? 0) + mo.quantity_kg)
    }
    const confirmedByWeek = new Map<string, Map<string, number>>()
    for (const mo of materialOrders) {
      if (mo.status === 'initial_stock' || !CONFIRMED_M.has(mo.status)) continue
      const weekStart = getMondayStr(toDateStr(mo.delivery_date))
      if (weekStart < firstWeek) continue
      if (!confirmedByWeek.has(weekStart)) confirmedByWeek.set(weekStart, new Map())
      const wm = confirmedByWeek.get(weekStart)!
      wm.set(mo.material_name, (wm.get(mo.material_name) ?? 0) + mo.quantity_kg)
    }
    const result = new Map<string, number>()
    for (const g of GROUP_ORDER) {
      let balance = openingBalance.get(g) ?? 0
      for (const weekStart of flowWeeks) {
        balance = balance - (weeklyConsumption.get(weekStart)?.get(g) ?? 0) + (confirmedByWeek.get(weekStart)?.get(g) ?? 0)
      }
      result.set(g, balance)
    }
    return result
  }, [materialOrders, products, plans])

  const sortedProducts = useMemo(() =>
    [...products].sort((a, b) => {
      const ga = GROUP_ORDER.indexOf(a.group_name), gb = GROUP_ORDER.indexOf(b.group_name)
      if (ga !== gb) return ga - gb; return a.sort_order - b.sort_order
    }), [products])

  const productMap = useMemo(() => {
    const m = new Map<string, ProductMaster>()
    for (const p of products) m.set(p.product_code, p)
    return m
  }, [products])

  const nameMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const o of orders) { if (o.product_name && !m.has(o.product_code)) m.set(o.product_code, o.product_name) }
    return m
  }, [orders])

  const mfgLots = useMemo(() => {
    const earliest = new Map<string, string>()
    for (const o of orders) {
      if (!o.mfg_lot_no || !o.delivery_date) continue
      const d = toDateStr(o.delivery_date), cur = earliest.get(o.mfg_lot_no)
      if (!cur || d < cur) earliest.set(o.mfg_lot_no, d)
    }
    return Array.from(earliest.keys()).sort((a, b) => (earliest.get(a) ?? '').localeCompare(earliest.get(b) ?? ''))
  }, [orders])

  const mfgLotRanges = useMemo(() => {
    const minDate = new Map<string, string>(), maxDate = new Map<string, string>()
    for (const o of orders) {
      if (!o.mfg_lot_no || !o.delivery_date) continue
      const d = toDateStr(o.delivery_date)
      const curMin = minDate.get(o.mfg_lot_no), curMax = maxDate.get(o.mfg_lot_no)
      if (!curMin || d < curMin) minDate.set(o.mfg_lot_no, d)
      if (!curMax || d > curMax) maxDate.set(o.mfg_lot_no, d)
    }
    const ranges = new Map<string, { start: string; end: string | null }>()
    for (const lot of mfgLots) ranges.set(lot, { start: minDate.get(lot) ?? '', end: maxDate.get(lot) ?? null })
    return ranges
  }, [mfgLots, orders])

  interface LotFlow { mfgLot: string; openingStock: number; demand: number; shortageUnits: number; shortageKg: number; demandKg: number }
  interface ProductFlow { productCode: string; productName: string; groupName: string; weightG: number | null; lots: LotFlow[]; totalShortageKg: number }

  const productFlows = useMemo((): ProductFlow[] => {
    const result: ProductFlow[] = []

    // Build material-constrained feasible production map: product_code -> week -> qty
    const CONFIRMED_M = new Set(['confirmed', 'delivery_confirmed', 'initial_stock'])
    const matPool = new Map<string, number>()
    for (const g of GROUP_ORDER) {
      matPool.set(g, materialOrders
        .filter(mo => mo.material_name === g && CONFIRMED_M.has(mo.status))
        .reduce((s, mo) => s + mo.quantity_kg, 0))
    }
    const allWeeks = Array.from(new Set(plans.map(pp => toDateStr(pp.week_start_date)))).sort()
    const matUsed  = new Map<string, number>()
    for (const g of GROUP_ORDER) matUsed.set(g, 0)

    // feasibleMap: product_code -> week_start -> feasible_qty
    const feasibleMap = new Map<string, Map<string, number>>()
    for (const wk of allWeeks) {
      const wkPlans = plans
        .filter(pp => toDateStr(pp.week_start_date) === wk)
        .sort((a, b) =>
          (products.find(pr => pr.product_code === a.product_code)?.sort_order ?? 999) -
          (products.find(pr => pr.product_code === b.product_code)?.sort_order ?? 999))
      for (const pp of wkPlans) {
        const pm2 = productMap.get(pp.product_code)
        if (!pm2?.weight_g || !pm2.group_name) continue
        const needed = (pp.planned_quantity * pm2.weight_g) / 1000
        const pool   = matPool.get(pm2.group_name) ?? 0
        const used   = matUsed.get(pm2.group_name) ?? 0
        if (used + needed <= pool) {
          matUsed.set(pm2.group_name, used + needed)
          if (!feasibleMap.has(pp.product_code)) feasibleMap.set(pp.product_code, new Map())
          feasibleMap.get(pp.product_code)!.set(wk, (feasibleMap.get(pp.product_code)!.get(wk) ?? 0) + pp.planned_quantity)
        }
      }
    }

    for (const p of sortedProducts) {
      const pm = productMap.get(p.product_code); if (!pm) continue
      const demandMap = new Map<string, number>()
      for (const o of orders) {
        if (o.product_code !== p.product_code || !o.mfg_lot_no) continue
        demandMap.set(o.mfg_lot_no, (demandMap.get(o.mfg_lot_no) ?? 0) + o.quantity)
      }
      if (demandMap.size === 0) continue

      const pFeasible = feasibleMap.get(p.product_code) ?? new Map<string, number>()

      // Running stock starts from initial_stock only
      let runningStock = pm.initial_stock ?? 0
      // Track which weeks have already been added to runningStock
      const addedWeeks = new Set<string>()

      const lots: LotFlow[] = []
      let totalShortageKg   = 0

      for (const lot of mfgLots) {
        const demand = demandMap.get(lot) ?? 0
        if (demand === 0) continue

        const lotStart = mfgLotRanges.get(lot)?.start ?? ''

        // Add production completed BEFORE this LOT's first delivery date
        // Week end (Friday) = monday + 4 days
        for (const [wk, qty] of pFeasible) {
          if (addedWeeks.has(wk)) continue
          const weekEnd = getWeekEndStr(wk)
          // If the week ends before the lot's first delivery, production is ready
          if (weekEnd < lotStart) {
            runningStock += qty
            addedWeeks.add(wk)
          }
        }

        const openingStock  = runningStock
        const shortageUnits = openingStock >= demand ? 0 : openingStock > 0 ? demand - openingStock : demand
        const shortageKg    = pm.weight_g ? (shortageUnits * pm.weight_g) / 1000 : 0
        const demandKg      = pm.weight_g ? (demand * pm.weight_g) / 1000 : 0
        totalShortageKg += shortageKg
        lots.push({ mfgLot: lot, openingStock, demand, shortageUnits, shortageKg, demandKg })
        runningStock -= demand
      }

      if (lots.length > 0) result.push({
        productCode:  p.product_code,
        productName:  nameMap.get(p.product_code) ?? '',
        groupName:    p.group_name,
        weightG:      pm.weight_g,
        lots,
        totalShortageKg,
      })
    }
    return result
  }, [sortedProducts, productMap, orders, mfgLots, mfgLotRanges, nameMap, materialOrders, plans, products])

  const groupSummary = useMemo(() => {
    const result = new Map<string, { totalShortageKg: number; shortCount: number; lotMap: Map<string, { shortageKg: number; shortCount: number }> }>()
    for (const pf of productFlows) {
      if (!result.has(pf.groupName)) result.set(pf.groupName, { totalShortageKg: 0, shortCount: 0, lotMap: new Map() })
      const grp = result.get(pf.groupName)!
      grp.totalShortageKg += pf.totalShortageKg
      if (pf.totalShortageKg > 0) grp.shortCount++
      for (const lf of pf.lots) {
        if (!grp.lotMap.has(lf.mfgLot)) grp.lotMap.set(lf.mfgLot, { shortageKg: 0, shortCount: 0 })
        const entry = grp.lotMap.get(lf.mfgLot)!
        entry.shortageKg += lf.shortageKg
        if (lf.shortageUnits > 0) entry.shortCount++
      }
    }
    return result
  }, [productFlows])

  function toggleGroup(g: string) { setExpandedGroups(prev => { const n = new Set(prev); n.has(g) ? n.delete(g) : n.add(g); return n }) }
  function toggleProduct(code: string) { setExpandedProducts(prev => { const n = new Set(prev); n.has(code) ? n.delete(code) : n.add(code); return n }) }

  const activeLots = useMemo(() => {
    const s = new Set<string>()
    for (const pf of productFlows) for (const lf of pf.lots) s.add(lf.mfgLot)
    return mfgLots.filter(l => s.has(l))
  }, [productFlows, mfgLots])

  return (
    <div className="h-full overflow-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">材料配分シミュレーター</h1>
          <p className="text-sm text-gray-400 mt-0.5">製造番号別 在庫フロー・必要材料量の計算</p>
        </div>
        <button onClick={fetchData} className="text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5">更新</button>
      </div>

      {!loading && (
        <div className="mb-6 grid grid-cols-4 gap-3">
          {GROUP_ORDER.map(g => {
            const grpSum       = groupSummary.get(g)
            const shortageKg   = grpSum?.totalShortageKg ?? 0
            const finalBalance = materialFinalBalance.get(g) ?? 0
            const net          = shortageKg - finalBalance
            return (
              <div key={g} className="bg-white rounded-xl border border-gray-200 px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${GROUP_COLORS[g].badge}`}>{g}</span>
                </div>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between text-gray-500">
                    <span>計画後残余</span>
                    <span className={`font-medium ${finalBalance < 0 ? 'text-red-600' : 'text-gray-700'}`}>{Math.round(finalBalance).toLocaleString()} kg</span>
                  </div>
                  <div className="flex justify-between text-gray-500">
                    <span>LOT不足量合計</span>
                    <span className="font-medium text-gray-700">{Math.round(shortageKg).toLocaleString()} kg</span>
                  </div>
                  <div className={`flex justify-between font-semibold border-t pt-1 ${net > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    <span>追加発注必要</span>
                    <span>{net > 0 ? `+${Math.round(net).toLocaleString()} kg` : '充足'}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="mb-4 flex items-start gap-3 px-4 py-3 bg-amber-50 border border-amber-300 rounded-xl">
        <span className="text-xl flex-shrink-0">🚧</span>
        <div>
          <p className="text-sm font-semibold text-amber-800">このページは開発中です — 参考値のみ</p>
          <p className="text-xs text-amber-600 mt-0.5">表示される数値は参考値であり、実際の生産計画・発注判断には使用しないでください。</p>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-sm text-gray-400">読み込み中...</div>
      ) : error ? (
        <div className="text-center py-20">
          <p className="text-sm text-red-500 mb-3">{error}</p>
          <button onClick={fetchData} className="text-sm text-blue-600 border border-blue-200 rounded-lg px-4 py-2">再試行</button>
        </div>
      ) : (
        <div className="space-y-4">
          {GROUP_ORDER.map(gname => {
            const gc              = GROUP_COLORS[gname]
            const gFlows          = productFlows.filter(pf => pf.groupName === gname)
            if (gFlows.length === 0) return null
            const grpSum          = groupSummary.get(gname)
            const isOpen          = expandedGroups.has(gname)
            const finalBalance    = materialFinalBalance.get(gname) ?? 0
            const totalShortageKg = grpSum?.totalShortageKg ?? 0
            const netNeeded       = Math.max(0, totalShortageKg - finalBalance)
            const gLots           = activeLots.filter(lot => gFlows.some(pf => pf.lots.some(lf => lf.mfgLot === lot)))

            return (
              <div key={gname} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <button onClick={() => toggleGroup(gname)}
                  className={`w-full flex items-center justify-between px-5 py-3.5 ${gc.header} text-white`}>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${gc.badge}`}>{gname}</span>
                    <span className="text-sm font-medium">
                      {totalShortageKg > 0 ? `⚠️ LOT不足 ${Math.ceil(totalShortageKg).toLocaleString()} kg / 追加発注必要 ${Math.ceil(netNeeded).toLocaleString()} kg` : '✅ 全LOT充足'}
                    </span>
                  </div>
                  <svg className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {isOpen && (
                  <div className="overflow-x-auto">
                    <table className="text-xs border-collapse w-full" style={{ minWidth: 'max-content' }}>
                      <thead>
                        <tr className="bg-gray-800 text-white">
                          <th className="sticky left-0 z-20 bg-gray-800 px-4 py-2.5 text-left font-medium whitespace-nowrap min-w-[200px] border-r border-gray-600">品番 / 品名</th>
                          <th className="px-3 py-2.5 text-right font-medium whitespace-nowrap min-w-[70px] border-r border-gray-600 bg-gray-700">重量(g)</th>
                          <th className="px-3 py-2.5 text-right font-medium whitespace-nowrap min-w-[90px] border-r border-gray-600 bg-gray-700">LOT不足合計</th>
                          {gLots.map(lot => {
                            const range    = mfgLotRanges.get(lot)
                            const lotSum   = grpSum?.lotMap.get(lot)
                            const hasShort = (lotSum?.shortCount ?? 0) > 0
                            const dateLabel = range
                              ? range.end && range.end !== range.start ? `${fmtDate(range.start)}〜${fmtDate(range.end)}` : fmtDate(range.start)
                              : ''
                            return (
                              <th key={lot} className={`px-3 py-2 text-center font-medium whitespace-nowrap border-r border-gray-600 min-w-[110px] ${hasShort ? 'bg-red-900/50' : ''}`}>
                                <div className="font-bold">{lot}</div>
                                <div className="text-[10px] opacity-60 font-normal mt-0.5">{dateLabel}</div>
                              </th>
                            )
                          })}
                        </tr>
                        <tr className="bg-gray-100 border-b-2 border-gray-300">
                          <td className="sticky left-0 z-20 bg-gray-100 px-4 py-2 font-semibold text-gray-600 border-r border-gray-300 whitespace-nowrap">材料必要量合計</td>
                          <td className="px-3 py-2 text-right text-gray-400 border-r border-gray-300">kg</td>
                          <td className="px-3 py-2 text-right border-r border-gray-300">
                            <div className={`font-bold ${totalShortageKg > 0 ? 'text-red-700' : 'text-green-700'}`}>{Math.ceil(totalShortageKg).toLocaleString()} kg</div>
                            <div className="text-[10px] text-gray-400 mt-0.5">LOT不足合計</div>
                            <div className={`text-[10px] mt-0.5 ${finalBalance < 0 ? 'text-red-500' : 'text-gray-400'}`}>計画後残余: {Math.round(finalBalance).toLocaleString()} kg</div>
                            <div className={`text-[10px] font-semibold mt-0.5 ${netNeeded > 0 ? 'text-red-600' : 'text-green-600'}`}>{netNeeded > 0 ? `要発注: ${Math.ceil(netNeeded).toLocaleString()} kg` : '在庫で充足'}</div>
                          </td>
                          {gLots.map(lot => {
                            const lotSum   = grpSum?.lotMap.get(lot)
                            const shortKg  = lotSum?.shortageKg ?? 0
                            const shortCnt = lotSum?.shortCount ?? 0
                            return (
                              <td key={lot} className={`px-3 py-2 text-center border-r border-gray-300 ${shortCnt > 0 ? 'bg-red-50' : 'bg-green-50/60'}`}>
                                {shortCnt > 0 ? (
                                  <><div className="font-bold text-red-700">{Math.ceil(shortKg).toLocaleString()} kg</div><div className="text-red-500 text-[10px] mt-0.5">{shortCnt}品番不足</div></>
                                ) : <div className="text-green-600 font-medium">✓ 充足</div>}
                              </td>
                            )
                          })}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {gFlows.map(pf => {
                          const lotMap         = new Map(pf.lots.map(l => [l.mfgLot, l]))
                          const isExpanded     = expandedProducts.has(pf.productCode)
                          const hasAnyShortage = pf.lots.some(l => l.shortageUnits > 0)
                          return (
                            <>
                              <tr key={pf.productCode}
                                className={`cursor-pointer hover:brightness-95 ${hasAnyShortage ? 'bg-red-50/20' : 'bg-white'}`}
                                onClick={() => toggleProduct(pf.productCode)}>
                                <td className="sticky left-0 z-10 bg-white px-4 py-2.5 border-r border-gray-200 whitespace-nowrap">
                                  <div className="flex items-center gap-1.5">
                                    <svg className={`w-3 h-3 text-gray-400 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                    </svg>
                                    <div>
                                      <div className="font-mono text-gray-600 text-[11px]">{pf.productCode}</div>
                                      <div className="text-gray-500 text-[11px] truncate max-w-[160px]">{pf.productName}</div>
                                    </div>
                                  </div>
                                </td>
                                <td className="px-3 py-2.5 text-right text-gray-400 border-r border-gray-200 whitespace-nowrap">
                                  {pf.weightG != null ? pf.weightG : <span className="text-amber-400">未設定</span>}
                                </td>
                                <td className="px-3 py-2.5 text-right border-r border-gray-200 whitespace-nowrap">
                                  {pf.totalShortageKg > 0 ? <span className="font-semibold text-red-600">{Math.ceil(pf.totalShortageKg).toLocaleString()} kg</span> : <span className="text-green-500">✓</span>}
                                </td>
                                {gLots.map(lot => {
                                  const lf = lotMap.get(lot)
                                  if (!lf) return <td key={lot} className="px-3 py-2.5 text-center text-gray-200 border-r border-gray-100">—</td>
                                  const isShort = lf.shortageUnits > 0
                                  return (
                                    <td key={lot} className={`px-3 py-2.5 text-center border-r border-gray-100 ${isShort ? 'bg-red-50' : 'bg-green-50/20'}`}
                                      title={`期首在庫: ${lf.openingStock.toLocaleString()} / 需要: ${lf.demand.toLocaleString()} / 不足: ${lf.shortageUnits.toLocaleString()}個`}>
                                      {isShort ? (
                                        <div>
                                          <div className="text-red-700 font-bold text-[11px]">⚠ {lf.shortageUnits.toLocaleString()}個</div>
                                          <div className="text-red-500 text-[10px]">{lf.shortageKg > 0 ? `${Math.ceil(lf.shortageKg).toLocaleString()} kg` : '重量未設定'}</div>
                                        </div>
                                      ) : <span className="text-green-500 text-base">✓</span>}
                                    </td>
                                  )
                                })}
                              </tr>
                              {isExpanded && (
                                <tr key={`${pf.productCode}-detail`} className="bg-gray-50/80">
                                  <td className="sticky left-0 z-10 bg-gray-50 px-4 py-0 border-r border-gray-200" />
                                  <td className="px-3 py-0 border-r border-gray-200" />
                                  <td className="px-3 py-0 border-r border-gray-200" />
                                  {gLots.map(lot => {
                                    const lf = lotMap.get(lot)
                                    if (!lf) return <td key={lot} className="border-r border-gray-100" />
                                    const isShort = lf.shortageUnits > 0
                                    return (
                                      <td key={lot} className={`border-r border-gray-100 text-[10px] ${isShort ? 'bg-red-50/60' : ''}`}>
                                        <div className="divide-y divide-gray-100 py-1">
                                          <div className="flex justify-between px-3 py-1">
                                            <span className="text-gray-400">期首在庫</span>
                                            <span className={`tabular-nums font-medium ${lf.openingStock <= 0 ? 'text-red-500' : 'text-gray-600'}`}>{lf.openingStock.toLocaleString()}</span>
                                          </div>
                                          <div className="flex justify-between px-3 py-1">
                                            <span className="text-orange-400">出荷需要</span>
                                            <span className="tabular-nums text-orange-600">−{lf.demand.toLocaleString()}</span>
                                          </div>
                                          <div className="flex justify-between px-3 py-1">
                                            <span className="text-gray-400">不足数量</span>
                                            <span className={`tabular-nums font-bold ${isShort ? 'text-red-600' : 'text-green-600'}`}>{isShort ? `${lf.shortageUnits.toLocaleString()}個` : '0'}</span>
                                          </div>
                                          {isShort && lf.shortageKg > 0 && (
                                            <div className="flex justify-between px-3 py-1 text-red-600 font-semibold bg-red-50">
                                              <span>必要材料</span>
                                              <span className="tabular-nums">{Math.ceil(lf.shortageKg).toLocaleString()} kg</span>
                                            </div>
                                          )}
                                        </div>
                                      </td>
                                    )
                                  })}
                                </tr>
                              )}
                            </>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}