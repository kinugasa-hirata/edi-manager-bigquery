'use client'

import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { databases, DB_ID, COLLECTIONS } from '@/lib/appwrite'
import { Query, ID, Permission, Role } from 'appwrite'
import { useAuth } from '@/lib/auth-context'

// ── Types ────────────────────────────────────────────────────────────────────
interface ProductMaster {
  $id: string
  product_code: string
  product_name?: string
  group_name: string
  weight_g: number | null
  sort_order: number
  initial_stock: number | null
}

interface ProductionPlan {
  $id: string
  product_code: string
  week_start_date: string
  planned_quantity: number
}

interface MaterialOrder {
  $id: string
  material_name: string
  quantity_kg: number
  delivery_date: string
  status: MaterialStatus
}

type MaterialStatus = 'initial_stock' | 'pending' | 'ordered' | 'confirmed' | 'delivery_confirmed' | 'delayed'

// ── Save state types ──────────────────────────────────────────────────────────
type SaveStatus = 'idle' | 'saving' | 'success' | 'error'

interface FailedSave {
  id: string
  productCode: string
  weekStart: string
  quantity: number
  error: string
  timestamp: number
}

// ── Constants ────────────────────────────────────────────────────────────────
const GROUP_ORDER = ['M90S', '300NP', '100G20', '950X01']
const GROUP_COLORS: Record<string, { badge: string; header: string }> = {
  'M90S':   { badge: 'bg-blue-50 text-blue-700',     header: 'bg-blue-800' },
  '300NP':  { badge: 'bg-green-50 text-green-700',   header: 'bg-green-800' },
  '100G20': { badge: 'bg-red-50 text-red-700',       header: 'bg-red-800' },
  '950X01': { badge: 'bg-purple-50 text-purple-700', header: 'bg-purple-800' },
}

const CONFIRMED_MATERIAL: MaterialStatus[] = ['confirmed', 'delivery_confirmed']

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

function isBusinessDay(date: Date): boolean {
  const dow = date.getDay()
  if (dow === 0 || dow === 6) return false
  return !JP_HOLIDAYS.has(date.toISOString().slice(0, 10))
}

function getMondayOf(date: Date): Date {
  const d = new Date(date)
  const dow = d.getDay()
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow))
  d.setHours(0, 0, 0, 0)
  return d
}

function getLastBusinessDayOfWeek(monday: Date): Date {
  for (let offset = 4; offset >= 0; offset--) {
    const d = new Date(monday)
    d.setDate(d.getDate() + offset)
    if (isBusinessDay(d)) return d
  }
  return monday
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function toDateStr(d: Date): string {
  const y  = d.getFullYear()
  const m  = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

function formatWeek(monday: Date): string {
  const last = getLastBusinessDayOfWeek(monday)
  const m1 = monday.getMonth() + 1, d1 = monday.getDate()
  const m2 = last.getMonth() + 1,   d2 = last.getDate()
  return m1 === m2 ? `${m1}/${d1}–${d2}` : `${m1}/${d1}–${m2}/${d2}`
}

function generateWeeks(startDate: Date, endDate: Date): Date[] {
  const weeks: Date[] = []
  let current = getMondayOf(startDate)
  while (current <= endDate) {
    weeks.push(new Date(current))
    current = addDays(current, 7)
  }
  return weeks
}

// ── Failed Saves Banner ───────────────────────────────────────────────────────
function FailedSavesBanner({
  failures,
  onRetry,
  onDismiss,
}: {
  failures: FailedSave[]
  onRetry: (f: FailedSave) => void
  onDismiss: (id: string) => void
}) {
  if (failures.length === 0) return null

  return (
    <div className="mb-4 px-4 py-3 bg-orange-50 border border-orange-300 rounded-lg shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <span className="text-orange-600 text-sm mt-0.5 shrink-0">⚡</span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-orange-800 mb-1">
              保存に失敗したセルがあります — データはローカルにのみ反映されています
            </p>
            <div className="flex flex-col gap-1.5">
              {failures.map(f => (
                <div key={f.id} className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] bg-orange-100 border border-orange-200 text-orange-700 px-2 py-0.5 rounded font-mono">
                    {f.productCode} / {f.weekStart.slice(5).replace('-', '/')}週 = {f.quantity.toLocaleString()}
                  </span>
                  <span className="text-[10px] text-orange-500 truncate max-w-[200px]" title={f.error}>
                    {f.error.length > 60 ? f.error.slice(0, 60) + '…' : f.error}
                  </span>
                  <button
                    onClick={() => onRetry(f)}
                    className="text-[11px] font-semibold text-orange-700 hover:text-orange-900 underline underline-offset-2 transition-colors"
                  >
                    再試行
                  </button>
                  <button
                    onClick={() => onDismiss(f.id)}
                    className="text-[11px] text-orange-400 hover:text-orange-600 transition-colors"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Editable Cell ─────────────────────────────────────────────────────────────
function EditableCell({
  value,
  onSave,
  warning,
}: {
  value: number
  onSave: (v: number) => Promise<{ ok: boolean; error?: string }>
  warning?: string
}) {
  const [editing,    setEditing]    = useState(false)
  const [input,      setInput]      = useState('')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [errorMsg,   setErrorMsg]   = useState<string>('')
  const ref         = useRef<HTMLInputElement>(null)
  const timerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Track the latest committed value so the cell shows pending value
  // while saving, then reverts only on confirmed error
  const pendingValue = useRef<number>(value)

  // Sync pendingValue when value prop changes (after DB round-trip)
  useEffect(() => {
    if (saveStatus === 'idle' || saveStatus === 'success') {
      pendingValue.current = value
    }
  }, [value, saveStatus])

  // Clear success indicator after 2 s
  useEffect(() => {
    if (saveStatus === 'success') {
      timerRef.current = setTimeout(() => setSaveStatus('idle'), 2000)
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [saveStatus])

  function startEdit() {
    if (saveStatus === 'saving') return
    setInput(value > 0 ? String(value) : '')
    setEditing(true)
    setTimeout(() => ref.current?.select(), 0)
  }

  async function commit() {
    const n = parseInt(input, 10)
    const newVal = isNaN(n) ? 0 : Math.max(0, n)
    setEditing(false)
    if (newVal === value) return

    pendingValue.current = newVal
    setSaveStatus('saving')
    setErrorMsg('')

    const result = await onSave(newVal)
    if (result.ok) {
      setSaveStatus('success')
    } else {
      setSaveStatus('error')
      setErrorMsg(result.error ?? '不明なエラー')
      // Do NOT revert the displayed value — parent already has it in local state.
      // The failure banner will allow retry.
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter')  commit()
    if (e.key === 'Escape') setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={ref}
        type="number"
        value={input}
        onChange={e => setInput(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKey}
        className="w-full text-right text-xs px-1 py-0.5 border border-blue-400 rounded focus:outline-none bg-blue-50"
        style={{ minWidth: 60 }}
      />
    )
  }

  const displayValue = pendingValue.current

  // ── Visual state ───────────────────────────────────────────────────────────
  if (saveStatus === 'saving') {
    return (
      <div className="w-full flex items-center justify-end gap-1 px-2 py-1">
        {/* Minimal spinner */}
        <svg
          className="animate-spin"
          width="10" height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          style={{ color: '#9ca3af' }}
        >
          <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
          <path d="M12 2a10 10 0 0 1 10 10" />
        </svg>
        <span className="text-xs tabular-nums text-gray-400">
          {displayValue > 0 ? displayValue.toLocaleString() : '—'}
        </span>
      </div>
    )
  }

  if (saveStatus === 'success') {
    return (
      <div className="w-full flex items-center justify-end gap-1 px-2 py-1">
        <span
          className="text-[10px] font-bold text-emerald-600"
          style={{ lineHeight: 1 }}
        >
          ✓
        </span>
        <span className="text-xs tabular-nums font-medium text-emerald-700">
          {displayValue > 0 ? displayValue.toLocaleString() : '—'}
        </span>
      </div>
    )
  }

  if (saveStatus === 'error') {
    return (
      <button
        onClick={startEdit}
        title={`保存失敗 — クリックして再編集\n${errorMsg}`}
        className="w-full flex items-center justify-end gap-1 px-2 py-1 rounded bg-orange-50 border border-orange-300 hover:bg-orange-100 transition-colors"
      >
        <span className="text-[9px] font-bold text-orange-500">!</span>
        <span className="text-xs tabular-nums font-semibold text-orange-700">
          {displayValue > 0 ? displayValue.toLocaleString() : '—'}
        </span>
      </button>
    )
  }

  // Idle state
  const warnBg = warning ? 'bg-red-50 border border-red-200' : ''
  return (
    <button
      onClick={startEdit}
      title={warning ?? undefined}
      className={`w-full text-right text-xs px-2 py-1 rounded transition-colors tabular-nums ${warnBg} ${
        displayValue > 0
          ? warning
            ? 'text-red-700 font-semibold'
            : 'text-gray-800 font-medium hover:bg-blue-50'
          : 'text-gray-200 hover:bg-gray-50 hover:text-gray-400'
      }`}
    >
      {displayValue > 0 ? (
        <span className="flex items-center justify-end gap-1">
          {warning && <span className="text-[9px]">⚠</span>}
          {displayValue.toLocaleString()}
        </span>
      ) : '—'}
    </button>
  )
}

// ── Initial Stock Cell ────────────────────────────────────────────────────────
function InitialStockCell({ value }: { value: number | null }) {
  return (
    <div
      title="初期在庫はデータベースから直接編集してください"
      className="w-full text-right text-xs px-2 py-1 tabular-nums select-none cursor-default text-amber-700 font-semibold bg-amber-50/60"
    >
      {value != null ? value.toLocaleString() : <span className="text-gray-300">—</span>}
    </div>
  )
}

// ── 受注残 Cell ───────────────────────────────────────────────────────────────
function OrderBacklogCell({ orderTotal, initialStock, feasibleTotal }: {
  orderTotal: number
  initialStock: number | null
  feasibleTotal: number
}) {
  const stock   = initialStock ?? 0
  const backlog = orderTotal - stock - feasibleTotal

  if (orderTotal === 0) {
    return (
      <div className="w-full text-right text-xs px-2 py-1 tabular-nums text-gray-300">—</div>
    )
  }

  if (backlog <= 0) {
    return (
      <div
        title={`受注合計 ${orderTotal.toLocaleString()} − 初期在庫 ${stock.toLocaleString()} − 実行可能製造 ${feasibleTotal.toLocaleString()} = 充足`}
        className="w-full text-right text-xs px-2 py-1 tabular-nums font-semibold text-green-700 bg-green-50/70 select-none"
      >
        ✓
      </div>
    )
  }

  return (
    <div
      title={`受注合計 ${orderTotal.toLocaleString()} − 初期在庫 ${stock.toLocaleString()} − 実行可能製造 ${feasibleTotal.toLocaleString()} = 不足 ${backlog.toLocaleString()} 個`}
      className="w-full text-right text-xs px-2 py-1 tabular-nums font-bold text-red-700 bg-red-50/70 select-none"
    >
      {backlog.toLocaleString()}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ProductionPage() {
  const { isGuest, isEditor } = useAuth()
  const isReadOnly = isGuest

  const [products,       setProducts]       = useState<ProductMaster[]>([])
  const [plans,          setPlans]          = useState<ProductionPlan[]>([])
  const [materialOrders, setMaterialOrders] = useState<MaterialOrder[]>([])
  const [orderTotalMap,  setOrderTotalMap]  = useState<Map<string, number>>(new Map())
  const [nameMap,        setNameMap]        = useState<Map<string, string>>(new Map())
  const [loading,        setLoading]        = useState(true)

  // Tracks cells whose DB write failed — shown in banner for retry
  const [failedSaves, setFailedSaves] = useState<FailedSave[]>([])

  // Stable ref so savePlan can read latest plans without being in its dep array
  const plansRef = useRef<ProductionPlan[]>([])

  // ── Fetch ──────────────────────────────────────────────────────────────────
  async function fetchData() {
    setLoading(true)
    try {
      const [pRes, plRes, oRes, mRes] = await Promise.all([
        databases.listDocuments(DB_ID, COLLECTIONS.PRODUCT_MASTER, [
          Query.orderAsc('sort_order'), Query.limit(100),
        ]),
        databases.listDocuments(DB_ID, COLLECTIONS.PRODUCTION_PLAN, [
          Query.limit(2000),
        ]),
        databases.listDocuments(DB_ID, COLLECTIONS.ORDERS, [
          Query.equal('status', 'active'), Query.limit(2000),
        ]),
        databases.listDocuments(DB_ID, COLLECTIONS.MATERIAL_ORDERS, [
          Query.limit(500),
        ]),
      ])
      setProducts(pRes.documents as unknown as ProductMaster[])
      setPlans(plRes.documents as unknown as ProductionPlan[])
      setMaterialOrders(mRes.documents as unknown as MaterialOrder[])

      const nm  = new Map<string, string>()
      const otm = new Map<string, number>()
      for (const o of oRes.documents as any[]) {
        if (o.product_name && !nm.has(o.product_code)) nm.set(o.product_code, o.product_name)
        otm.set(o.product_code, (otm.get(o.product_code) ?? 0) + (o.quantity ?? 0))
      }
      setNameMap(nm)
      setOrderTotalMap(otm)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [])

  // Keep ref in sync so savePlan always sees latest plans without a dep
  useEffect(() => { plansRef.current = plans }, [plans])

  // ── Week columns ───────────────────────────────────────────────────────────
  const weeks = useMemo(() => {
    const start = new Date('2026-04-01T00:00:00')
    const end   = new Date('2027-03-31T00:00:00')
    return generateWeeks(start, end)
  }, [])

  // ── Plan lookup ────────────────────────────────────────────────────────────
  const planMap = useMemo(() => {
    const map = new Map<string, Map<string, number>>()
    for (const p of plans) {
      if (!map.has(p.product_code)) map.set(p.product_code, new Map())
      const weekKey = toDateStr(getMondayOf(new Date(p.week_start_date + 'T00:00:00')))
      map.get(p.product_code)!.set(weekKey, p.planned_quantity)
    }
    return map
  }, [plans])

  // ── Weight + group lookup ──────────────────────────────────────────────────
  const weightMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of products) {
      if (p.weight_g) m.set(p.product_code.trim(), p.weight_g)
    }
    return m
  }, [products])

  const groupMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of products) {
      if (p.group_name) m.set(p.product_code.trim(), p.group_name.trim())
    }
    return m
  }, [products])

  // ── Effective plan map ─────────────────────────────────────────────────────
  const effectivePlanMap = useMemo(() => {
    const firstWeek = weeks.length > 0 ? toDateStr(weeks[0]) : ''

    const matBalance = new Map<string, number>()
    for (const g of GROUP_ORDER) {
      const initEntry = materialOrders
        .filter(o => o.status === 'initial_stock' && o.material_name === g)
        .sort((a, b) => b.delivery_date.localeCompare(a.delivery_date))[0]
      const initKg = initEntry?.quantity_kg ?? 0
      const preConfirmed = materialOrders
        .filter(o =>
          o.material_name === g &&
          CONFIRMED_MATERIAL.includes(o.status) &&
          o.delivery_date.slice(0, 10) < firstWeek,
        )
        .reduce((s, o) => s + o.quantity_kg, 0)
      matBalance.set(g, initKg + preConfirmed)
    }

    const arrivals = new Map<string, Map<string, number>>()
    for (const o of materialOrders) {
      if (!CONFIRMED_MATERIAL.includes(o.status)) continue
      const weekStr = toDateStr(getMondayOf(new Date(o.delivery_date + 'T00:00:00')))
      if (weekStr < firstWeek) continue
      if (!arrivals.has(weekStr)) arrivals.set(weekStr, new Map())
      arrivals.get(weekStr)!.set(o.material_name,
        (arrivals.get(weekStr)!.get(o.material_name) ?? 0) + o.quantity_kg)
    }

    const effective = new Map<string, Map<string, number>>()

    for (const week of weeks) {
      const weekStr = toDateStr(week)
      for (const [g, kg] of (arrivals.get(weekStr) ?? new Map())) {
        matBalance.set(g, (matBalance.get(g) ?? 0) + kg)
      }

      const weekProducers = [...products]
        .filter(p => planMap.get(p.product_code)?.has(weekStr) && weightMap.get(p.product_code.trim()))
        .sort((a, b) => {
          const ga = GROUP_ORDER.indexOf(a.group_name)
          const gb = GROUP_ORDER.indexOf(b.group_name)
          if (ga !== gb) return ga - gb
          return a.sort_order - b.sort_order
        })

      for (const product of weekProducers) {
        const pc      = product.product_code.trim()
        const group   = groupMap.get(pc) ?? product.group_name
        const wg      = weightMap.get(pc) ?? 0
        const planned = planMap.get(product.product_code)?.get(weekStr) ?? 0
        if (planned === 0 || wg === 0) continue

        const needed     = (planned * wg) / 1000
        const available  = matBalance.get(group) ?? 0
        const executable = available >= needed
          ? planned
          : Math.floor((available * 1000) / wg)

        if (!effective.has(product.product_code)) effective.set(product.product_code, new Map())
        effective.get(product.product_code)!.set(weekStr, executable)

        const actualKg = (executable * wg) / 1000
        matBalance.set(group, Math.max(0, available - actualKg))
      }
    }

    return effective
  }, [materialOrders, plans, products, weeks, planMap, weightMap, groupMap])

  // ── Material warning ───────────────────────────────────────────────────────
  function getMaterialWarning(productCode: string, weekStr: string, plannedQty: number): string | undefined {
    if (plannedQty === 0) return undefined
    const executable = effectivePlanMap.get(productCode)?.get(weekStr) ?? 0
    if (executable >= plannedQty) return undefined

    const code = productCode.trim()
    const wg   = weightMap.get(code)
    const grp  = groupMap.get(code)
    if (!wg || !grp) return undefined

    const materialNeeded  = (plannedQty * wg) / 1000
    const materialActual  = (executable * wg) / 1000
    const shortfall       = materialNeeded - materialActual

    return `⚠️ 材料不足: ${grp} 必要${Math.round(materialNeeded).toLocaleString()}kg / 実行可能${executable.toLocaleString()}個 (不足${Math.round(shortfall).toLocaleString()}kg)`
  }

  // ── Shortage weeks ─────────────────────────────────────────────────────────
  const shortageWeeks = useMemo(() => {
    const issues: { group: string; week: string; neededKg: number; executableKg: number }[] = []

    for (const week of weeks) {
      const weekStr = toDateStr(week)
      for (const g of GROUP_ORDER) {
        const gProducts = products.filter(p => p.group_name === g)
        let plannedKg    = 0
        let executableKg = 0
        for (const p of gProducts) {
          const planned    = planMap.get(p.product_code)?.get(weekStr) ?? 0
          const executable = effectivePlanMap.get(p.product_code)?.get(weekStr) ?? 0
          const wg         = weightMap.get(p.product_code.trim()) ?? 0
          plannedKg    += (planned * wg) / 1000
          executableKg += (executable * wg) / 1000
        }
        if (plannedKg > 0 && executableKg < plannedKg - 0.01) {
          issues.push({ group: g, week: weekStr, neededKg: plannedKg, executableKg })
        }
      }
    }
    return issues
  }, [effectivePlanMap, planMap, products, weeks, weightMap])

  // ── Save production plan — returns ok/error result ─────────────────────────
  const savePlan = useCallback(async (
    productCode: string,
    weekStart: string,
    quantity: number,
  ): Promise<{ ok: boolean; error?: string }> => {
    const normWeekStart = toDateStr(getMondayOf(new Date(weekStart + 'T00:00:00')))
    // Read from ref — no stale closure, no dependency on plans state
    const existing = plansRef.current.find(
      p => p.product_code === productCode &&
        toDateStr(getMondayOf(new Date(p.week_start_date + 'T00:00:00'))) === normWeekStart,
    )

    // Optimistically update local state immediately so UI feels snappy
    setPlans(prev => {
      const filtered = prev.filter(p => !(
        p.product_code === productCode &&
        toDateStr(getMondayOf(new Date(p.week_start_date + 'T00:00:00'))) === normWeekStart
      ))
      return quantity > 0
        ? [...filtered, { $id: existing?.$id ?? 'temp', product_code: productCode, week_start_date: normWeekStart, planned_quantity: quantity }]
        : filtered
    })

    if (isReadOnly) {
      // Guest: local only, always succeeds
      return { ok: true }
    }

    // Attempt DB write
    try {
      if (existing) {
        if (quantity === 0) {
          await databases.deleteDocument(DB_ID, COLLECTIONS.PRODUCTION_PLAN, existing.$id)
        } else {
          await databases.updateDocument(DB_ID, COLLECTIONS.PRODUCTION_PLAN, existing.$id, { planned_quantity: quantity })
        }
      } else if (quantity > 0) {
        await databases.createDocument(
          DB_ID, COLLECTIONS.PRODUCTION_PLAN, ID.unique(),
          { product_code: productCode, week_start_date: normWeekStart, planned_quantity: quantity },
          [Permission.read(Role.users()), Permission.update(Role.users()), Permission.delete(Role.users())]
        )
      }
      // Remove any previous failure for this cell on success
      setFailedSaves(prev => prev.filter(f => !(f.productCode === productCode && f.weekStart === normWeekStart)))
      return { ok: true }
    } catch (err: any) {
      const errorStr: string =
        err?.message ?? err?.toString() ?? '保存に失敗しました'

      // Record into failure list (upsert by productCode+weekStart)
      const failureId = `${productCode}::${normWeekStart}`
      setFailedSaves(prev => {
        const without = prev.filter(f => f.id !== failureId)
        return [...without, {
          id: failureId,
          productCode,
          weekStart: normWeekStart,
          quantity,
          error: errorStr,
          timestamp: Date.now(),
        }]
      })
      return { ok: false, error: errorStr }
    }
  }, [isReadOnly])

  // ── Retry a failed save ────────────────────────────────────────────────────
  async function retryFailedSave(f: FailedSave) {
    // Remove from banner while retrying; result will re-add if it fails again
    setFailedSaves(prev => prev.filter(x => x.id !== f.id))
    await savePlan(f.productCode, f.weekStart, f.quantity)
  }

  function dismissFailedSave(id: string) {
    setFailedSaves(prev => prev.filter(f => f.id !== id))
  }

  // ── Column totals ───────────────────────────────────────────────────────────
  function weekTotal(weekStart: string): number {
    return products.reduce((sum, p) => sum + (planMap.get(p.product_code)?.get(weekStart) ?? 0), 0)
  }

  // ── Sorted products ─────────────────────────────────────────────────────────
  const sortedProducts = useMemo(() =>
    [...products].sort((a, b) => {
      const ga = GROUP_ORDER.indexOf(a.group_name)
      const gb = GROUP_ORDER.indexOf(b.group_name)
      if (ga !== gb) return ga - gb
      return a.sort_order - b.sort_order
    }), [products])

  const visibleWeeks = weeks

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="h-full overflow-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">製造計画</h2>
          <p className="text-sm text-gray-400 mt-0.5">
            週次製造数量の入力 — セルをクリックして編集
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span className="w-3 h-3 rounded bg-amber-100 border border-amber-300 inline-block" />初期在庫（DB直接編集）
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span className="w-3 h-3 rounded bg-red-50 border border-red-200 inline-block" />材料不足（計画数に未算入）
          </div>
          {/* Legend for new save states */}
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span className="w-3 h-3 rounded bg-orange-50 border border-orange-300 inline-block" />保存失敗（要再試行）
          </div>
          <button onClick={fetchData} className="text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5">
            更新
          </button>
        </div>
      </div>

      {/* Failed saves banner */}
      <FailedSavesBanner
        failures={failedSaves}
        onRetry={retryFailedSave}
        onDismiss={dismissFailedSave}
      />

      {/* Material shortage banner */}
      {shortageWeeks.length > 0 && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-xs font-semibold text-red-800 mb-2">
            ⚠️ 材料不足の週があります — 赤セルの製造数は在庫計算に算入されません
          </p>
          <div className="flex flex-wrap gap-2">
            {shortageWeeks.map((s, i) => (
              <span key={i} className="text-[11px] bg-red-100 text-red-700 px-2 py-1 rounded border border-red-200">
                <strong>{s.group}</strong> {s.week.slice(5).replace('-', '/')}週:
                必要 {Math.round(s.neededKg).toLocaleString()}kg /
                実行可能 {Math.round(s.executableKg).toLocaleString()}kg /
                不足 {Math.round(s.neededKg - s.executableKg).toLocaleString()}kg
              </span>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-20 text-sm text-gray-400">読み込み中...</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse" style={{ minWidth: 'max-content' }}>
              <thead className="sticky top-0 z-30">
                <tr className="bg-gray-800 text-white">
                  <th className="sticky left-0 z-40 bg-gray-800 border-r border-gray-600 px-3 py-2.5 text-left font-medium whitespace-nowrap min-w-[100px]">
                    グループ
                  </th>
                  <th className="sticky left-[100px] z-40 bg-gray-800 border-r border-gray-600 px-3 py-2.5 text-left font-medium whitespace-nowrap min-w-[160px]">
                    品番
                  </th>
                  <th className="sticky left-[260px] z-40 bg-gray-800 border-r border-gray-600 px-3 py-2.5 text-left font-medium whitespace-nowrap min-w-[120px]">
                    品名
                  </th>
                  <th className="sticky left-[380px] z-40 bg-gray-800 border-r border-gray-600 px-3 py-2.5 text-right font-medium whitespace-nowrap min-w-[80px]">
                    初期在庫
                  </th>
                  <th className="sticky left-[460px] z-40 bg-gray-700 border-r border-gray-500 px-3 py-2.5 text-right font-medium whitespace-nowrap min-w-[80px]"
                    style={{ boxShadow: '4px 0 10px -2px rgba(0,0,0,0.15)' }}>
                    <div>受注残</div>
                    <div className="text-[10px] font-normal opacity-60">要製造数</div>
                  </th>
                  {visibleWeeks.map(w => {
                    const ws = toDateStr(w)
                    const hasShortage = shortageWeeks.some(s => s.week === ws)
                    return (
                      <th key={ws}
                        className={`px-2 py-2.5 text-center font-medium whitespace-nowrap border-l border-gray-600 min-w-[80px] ${
                          hasShortage ? 'bg-red-900/40' : ''
                        }`}>
                        {formatWeek(w)}
                        {hasShortage && <div className="text-[9px] text-red-300 font-normal">材料不足</div>}
                      </th>
                    )
                  })}
                  <th className="px-3 py-2.5 text-right font-medium whitespace-nowrap border-l border-gray-600 min-w-[80px]">
                    合計
                  </th>
                </tr>
              </thead>

              <tbody>
                {GROUP_ORDER.map(gname => {
                  const gProducts = sortedProducts.filter(p => p.group_name === gname)
                  if (gProducts.length === 0) return null
                  const gc = GROUP_COLORS[gname]

                  const groupFirstWeekBalance = (() => {
                    if (weeks.length === 0) return 0
                    const firstWeekStr = toDateStr(weeks[0])
                    const initEntry = materialOrders
                      .filter(o => o.status === 'initial_stock' && o.material_name === gname)
                      .sort((a, b) => b.delivery_date.localeCompare(a.delivery_date))[0]
                    const initKg = initEntry?.quantity_kg ?? 0
                    const preConfirmed = materialOrders
                      .filter(o =>
                        o.material_name === gname &&
                        CONFIRMED_MATERIAL.includes(o.status) &&
                        o.delivery_date.slice(0, 10) < firstWeekStr,
                      )
                      .reduce((s, o) => s + o.quantity_kg, 0)
                    return initKg + preConfirmed
                  })()

                  return (
                    <>
                      <tr key={`g-${gname}`} className="border-t-2 border-gray-200">
                        <td colSpan={5 + visibleWeeks.length + 1} className={`px-3 py-1.5 ${gc.header}`}>
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${gc.badge}`}>
                            {gname}
                          </span>
                          <span className="ml-2 text-white/60 text-xs">{gProducts.length} 品番</span>
                          <span className="ml-3 text-white/50 text-xs">
                            材料残 {Math.round(groupFirstWeekBalance).toLocaleString()} kg
                          </span>
                        </td>
                      </tr>

                      {gProducts.map((p, idx) => {
                        const pMap       = planMap.get(p.product_code)
                        const rowSum     = visibleWeeks.reduce((s, w) => s + (pMap?.get(toDateStr(w)) ?? 0), 0)
                        const orderTotal = orderTotalMap.get(p.product_code) ?? 0
                        const feasibleSum = visibleWeeks.reduce((s, w) => {
                          const ws = toDateStr(w)
                          return s + (effectivePlanMap.get(p.product_code)?.get(ws) ?? 0)
                        }, 0)

                        return (
                          <tr key={p.product_code}
                            className={`border-b border-gray-100 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} hover:brightness-95`}>
                            <td className="sticky left-0 z-10 bg-white border-r border-gray-100 px-3 py-1.5 whitespace-nowrap">
                              {idx === 0 && (
                                <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${gc.badge}`}>{gname}</span>
                              )}
                            </td>
                            <td className="sticky left-[100px] z-10 bg-white border-r border-gray-100 px-3 py-1.5 font-mono text-gray-600 whitespace-nowrap">
                              {p.product_code}
                            </td>
                            <td className="sticky left-[260px] z-10 bg-white border-r border-gray-100 px-3 py-1.5 text-gray-500 whitespace-nowrap max-w-[120px] truncate">
                              {nameMap.get(p.product_code) ?? '—'}
                            </td>
                            <td className="sticky left-[380px] z-10 bg-white border-r border-gray-200 px-2 py-1.5">
                              <InitialStockCell value={p.initial_stock} />
                            </td>
                            <td className="sticky left-[460px] z-10 bg-white border-r border-gray-200 px-2 py-1.5"
                              style={{ boxShadow: '4px 0 10px -2px rgba(0,0,0,0.10)' }}>
                              <OrderBacklogCell
                                orderTotal={orderTotal}
                                initialStock={p.initial_stock}
                                feasibleTotal={feasibleSum}
                              />
                            </td>

                            {visibleWeeks.map(w => {
                              const ws      = toDateStr(w)
                              const qty     = pMap?.get(ws) ?? 0
                              const warning = getMaterialWarning(p.product_code, ws, qty)
                              return (
                                <td key={ws} className="border-l border-gray-100 px-1 py-1">
                                  <EditableCell
                                    value={qty}
                                    onSave={v => savePlan(p.product_code, ws, v)}
                                    warning={warning}
                                  />
                                </td>
                              )
                            })}

                            <td className="border-l border-gray-200 px-3 py-1.5 text-right font-semibold text-gray-700 tabular-nums whitespace-nowrap">
                              {rowSum > 0 ? rowSum.toLocaleString() : '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </>
                  )
                })}

                <tr className="bg-gray-800 text-white border-t-2 border-gray-400">
                  <td className="sticky left-0 z-10 bg-gray-800 border-r border-gray-600 px-3 py-2 font-bold text-xs whitespace-nowrap" colSpan={5}>
                    週別合計
                  </td>
                  {visibleWeeks.map(w => {
                    const ws    = toDateStr(w)
                    const total = weekTotal(ws)
                    const hasShortage = shortageWeeks.some(s => s.week === ws)
                    return (
                      <td key={ws}
                        className={`border-l border-gray-600 px-2 py-2 text-right font-semibold tabular-nums whitespace-nowrap ${
                          hasShortage ? 'text-red-300' : ''
                        }`}>
                        {total > 0 ? total.toLocaleString() : '—'}
                      </td>
                    )
                  })}
                  <td className="border-l border-gray-600 px-3 py-2 text-right font-bold tabular-nums whitespace-nowrap">
                    {products.reduce((sum, p) => {
                      const pMap = planMap.get(p.product_code)
                      return sum + visibleWeeks.reduce((s, w) => s + (pMap?.get(toDateStr(w)) ?? 0), 0)
                    }, 0).toLocaleString()}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}