'use client'

import { createContext, useContext, useState, useCallback, ReactNode } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────
export interface DailyStock {
  byProduct: Map<string, Map<string, number>>
  calculatedAt: Date
}

// A material order as stored in context (subset of full type)
export interface GuestMaterialOrder {
  $id: string
  material_name: string
  quantity_kg: number
  delivery_date: string
  order_date: string
  status: string
  note: string | null
  trading_company: string | null
}

interface StockContextType {
  dailyStock:          DailyStock | null
  setDailyStock:       (data: DailyStock) => void
  clearStock:          () => void
  // Guest simulation orders — persisted across navigation
  guestOrders:         GuestMaterialOrder[] | null  // null = not in guest mode yet
  setGuestOrders:      (orders: GuestMaterialOrder[]) => void
  clearGuestOrders:    () => void
  // Recalculate stock using provided material orders (for guest simulation)
  recalcWithOrders:    (materialOrders: GuestMaterialOrder[]) => Promise<void>
}

const StockContext = createContext<StockContextType>({
  dailyStock:       null,
  setDailyStock:    () => {},
  clearStock:       () => {},
  guestOrders:      null,
  setGuestOrders:   () => {},
  clearGuestOrders: () => {},
  recalcWithOrders: async () => {},
})

// ── Date helpers (timezone-safe) ──────────────────────────────────────────────
function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
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

function getMondayStr(s: string): string {
  const d = new Date(s + 'T00:00:00')
  const diff = d.getDay() === 0 ? -6 : 1 - d.getDay()
  d.setDate(d.getDate() + diff)
  return localDateStr(d)
}

function getWeekEndStr(mon: string): string {
  for (let i = 4; i >= 0; i--) {
    const d = new Date(mon + 'T00:00:00')
    d.setDate(d.getDate() + i)
    const s = localDateStr(d)
    if (isBusinessDay(s)) return s
  }
  return mon
}

// ── Core stock calculation (material-aware) ────────────────────────────────────
// Accepts optional materialOrders override — used for guest simulation.
// When undefined, fetches from DB (normal authenticated mode).
export async function calculateDailyStock(
  overrideMaterialOrders?: GuestMaterialOrder[]
): Promise<DailyStock | null> {
  try {
    const [oRes, pRes, plRes, mRes] = await Promise.all([
      databases.listDocuments(DB_ID, COLLECTIONS.ORDERS, [
        Query.equal('status', 'active'), Query.limit(2000),
      ]),
      databases.listDocuments(DB_ID, COLLECTIONS.PRODUCT_MASTER, [
        Query.orderAsc('sort_order'), Query.limit(200),
      ]),
      databases.listDocuments(DB_ID, COLLECTIONS.PRODUCTION_PLAN, [
        Query.limit(2000),
      ]),
      overrideMaterialOrders
        ? Promise.resolve({ documents: overrideMaterialOrders })
        : databases.listDocuments(DB_ID, COLLECTIONS.MATERIAL_ORDERS, [Query.limit(500)]),
    ])

    const orders         = oRes.documents as any[]
    const products       = pRes.documents as any[]
    const plans          = plRes.documents as any[]
    const materialOrders = (mRes as any).documents as any[]

    const CONFIRMED         = new Set(['confirmed', 'delivery_confirmed'])
    const GROUP_ORDER_LOCAL = ['M90S', '300NP', '100G20', '950X01']
    const today             = localDateStr(new Date())
    const firstWeek         = getMondayStr(today)

    // ── Material opening balance ──────────────────────────────────────────────
    const materialOpening = new Map<string, number>()
    for (const g of GROUP_ORDER_LOCAL) {
      const init = materialOrders
        .filter((o: any) => o.status === 'initial_stock' && o.material_name === g)
        .sort((a: any, b: any) => b.delivery_date.localeCompare(a.delivery_date))[0]
      const preConfirmed = materialOrders
        .filter((o: any) =>
          o.material_name === g &&
          CONFIRMED.has(o.status) &&
          getMondayStr(o.delivery_date.slice(0, 10)) < firstWeek
        )
        .reduce((s: number, o: any) => s + o.quantity_kg, 0)
      materialOpening.set(g, (init?.quantity_kg ?? 0) + preConfirmed)
    }

    // ── Confirmed arrivals by week ────────────────────────────────────────────
    const materialArrivals = new Map<string, Map<string, number>>()
    for (const o of materialOrders) {
      if (!CONFIRMED.has(o.status)) continue
      const weekStr = getMondayStr(o.delivery_date.slice(0, 10))
      if (weekStr < firstWeek) continue
      if (!materialArrivals.has(weekStr)) materialArrivals.set(weekStr, new Map())
      const wm = materialArrivals.get(weekStr)!
      wm.set(o.material_name, (wm.get(o.material_name) ?? 0) + o.quantity_kg)
    }

    // ── Production plan map (normalize week keys to Monday) ──────────────────
    const planMap = new Map<string, Map<string, number>>()
    for (const p of plans) {
      const weekKey = getMondayStr(p.week_start_date)
      if (!planMap.has(p.product_code)) planMap.set(p.product_code, new Map())
      planMap.get(p.product_code)!.set(weekKey, p.planned_quantity)
    }

    const allWeekKeys = new Set<string>()
    for (const p of plans) allWeekKeys.add(getMondayStr(p.week_start_date))
    const sortedWeeks = Array.from(allWeekKeys).sort()

    // ── Shipment map ──────────────────────────────────────────────────────────
    const shipMap = new Map<string, Map<string, number>>()
    for (const o of orders) {
      const d = o.delivery_date?.slice(0, 10)
      if (!d || !o.product_code) continue
      if (!shipMap.has(o.product_code)) shipMap.set(o.product_code, new Map())
      shipMap.get(o.product_code)!.set(d, (shipMap.get(o.product_code)!.get(d) ?? 0) + o.quantity)
    }

    // ── Cap production by available material (greedy by sort_order) ───────────
    const effectivePlanMap = new Map<string, Map<string, number>>()
    const matBalance = new Map<string, number>(materialOpening)

    for (const weekStr of sortedWeeks) {
      for (const [g, kg] of (materialArrivals.get(weekStr) ?? new Map())) {
        matBalance.set(g, (matBalance.get(g) ?? 0) + kg)
      }
      const weekProducers = products
        .filter((p: any) => planMap.get(p.product_code)?.has(weekStr) && p.weight_g)
        .sort((a: any, b: any) => a.sort_order - b.sort_order)

      for (const product of weekProducers) {
        const pc      = product.product_code
        const group   = product.group_name
        const wg      = product.weight_g ?? 0
        const planned = planMap.get(pc)?.get(weekStr) ?? 0
        if (planned === 0 || wg === 0) continue
        const needed     = (planned * wg) / 1000
        const available  = matBalance.get(group) ?? 0
        const executable = available >= needed ? planned : Math.floor((available * 1000) / wg)
        if (!effectivePlanMap.has(pc)) effectivePlanMap.set(pc, new Map())
        effectivePlanMap.get(pc)!.set(weekStr, executable)
        matBalance.set(group, Math.max(0, available - (executable * wg) / 1000))
      }
    }

    // ── Project finished-product stock ────────────────────────────────────────
    const result = new Map<string, Map<string, number>>()
    for (const product of products) {
      const pc = product.product_code
      if (product.initial_stock === null) continue
      const pStockMap = new Map<string, number>()
      const shipments = shipMap.get(pc)
      const pPlanMap  = effectivePlanMap.get(pc) ?? planMap.get(pc)
      const allDates  = new Set<string>(shipments ? Array.from(shipments.keys()) : [])
      if (pPlanMap) for (const ws of pPlanMap.keys()) allDates.add(getWeekEndStr(ws))
      const sortedDates = Array.from(allDates).sort()
      let stock = product.initial_stock
      if (pPlanMap && sortedDates.length > 0) {
        const firstDate = sortedDates[0]
        for (const [ws, qty] of pPlanMap) {
          if (getWeekEndStr(ws) < firstDate) stock += qty
        }
      }
      for (const dateStr of sortedDates) {
        if (pPlanMap) {
          const mon = getMondayStr(dateStr)
          if (dateStr === getWeekEndStr(mon)) stock += pPlanMap.get(mon) ?? 0
        }
        stock -= shipments?.get(dateStr) ?? 0
        pStockMap.set(dateStr, stock)
      }
      result.set(pc, pStockMap)
    }

    return { byProduct: result, calculatedAt: new Date() }
  } catch (e) {
    console.error('Stock calculation failed:', e)
    return null
  }
}

// ── Provider ──────────────────────────────────────────────────────────────────
export function StockProvider({ children }: { children: ReactNode }) {
  const [dailyStock,  setDailyStockState]  = useState<DailyStock | null>(null)
  const [guestOrders, setGuestOrdersState] = useState<GuestMaterialOrder[] | null>(null)

  const setDailyStock    = useCallback((data: DailyStock) => setDailyStockState(data), [])
  const clearStock       = useCallback(() => setDailyStockState(null), [])
  const setGuestOrders   = useCallback((o: GuestMaterialOrder[]) => setGuestOrdersState(o), [])
  const clearGuestOrders = useCallback(() => setGuestOrdersState(null), [])

  const recalcWithOrders = useCallback(async (materialOrders: GuestMaterialOrder[]) => {
    setGuestOrdersState(materialOrders)  // persist for navigation
    const result = await calculateDailyStock(materialOrders)
    if (result) setDailyStockState(result)
  }, [])

  return (
    <StockContext.Provider value={{
      dailyStock, setDailyStock, clearStock,
      guestOrders, setGuestOrders, clearGuestOrders,
      recalcWithOrders,
    }}>
      {children}
    </StockContext.Provider>
  )
}

export const useStock = () => useContext(StockContext)