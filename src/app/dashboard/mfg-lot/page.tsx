'use client'

import { useEffect, useState, useMemo, useRef } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────
interface Order {
  id: string
  product_code: string
  product_name: string
  group_name: string
  lot_number: string
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
}

// ── Constants ─────────────────────────────────────────────────────────────────
const GROUP_ORDER = ['M90S', '300NP', '100G20', '950X01']
const GROUP_COLORS: Record<string, { badge: string; header: string; solid: string; accent: string }> = {
  'M90S':   { badge: 'bg-blue-50 text-blue-700',     header: 'bg-blue-800',   solid: 'bg-blue-500',    accent: 'bg-blue-50' },
  '300NP':  { badge: 'bg-green-50 text-green-700',   header: 'bg-green-800',  solid: 'bg-emerald-500', accent: 'bg-emerald-50' },
  '100G20': { badge: 'bg-red-50 text-red-700',       header: 'bg-red-800',    solid: 'bg-rose-500',    accent: 'bg-rose-50' },
  '950X01': { badge: 'bg-purple-50 text-purple-700', header: 'bg-purple-800', solid: 'bg-violet-500',  accent: 'bg-violet-50' },
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

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function addDays(s: string, n: number): string {
  const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return localDateStr(d)
}
function isBusinessDay(s: string): boolean {
  const d = new Date(s + 'T00:00:00')
  if (d.getDay() === 0 || d.getDay() === 6) return false
  return !JP_HOLIDAYS.has(s)
}
function prevBizDay(s: string): string {
  let d = addDays(s, -1)
  for (let i = 0; i < 10; i++) { if (isBusinessDay(d)) return d; d = addDays(d, -1) }
  return d
}
function fmtDate(s: string | null): string {
  if (!s) return '—'
  const clean = s.slice(0, 10)
  const [y, m, dd] = clean.split('-')
  if (!y || !m || !dd) return '—'
  return `${parseInt(m)}/${parseInt(dd)}`
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function MfgLotPage() {
  const [orders,         setOrders]         = useState<Order[]>([])
  const [products,       setProducts]       = useState<ProductMaster[]>([])
  const [productionPlan, setProductionPlan] = useState<ProductionPlan[]>([])
  const [materialOrders, setMaterialOrders] = useState<MaterialOrder[]>([])
  const [loading,        setLoading]        = useState(true)
  const [error,          setError]          = useState('')

  async function fetchData() {
    setLoading(true); setError('')
    try {
      const [oRes, pRes, ppRes, mRes] = await Promise.all([
        fetch('/api/orders?status=active').then(r => r.json()),
        fetch('/api/products').then(r => r.json()),
        fetch('/api/production-plan').then(r => r.json()),
        fetch('/api/material-orders').then(r => r.json()),
      ])
      setOrders(oRes.data ?? [])
      setProducts(pRes.data ?? [])
      setProductionPlan(ppRes.data ?? [])
      setMaterialOrders(mRes.data ?? [])
    } catch (e: any) { setError(e?.message ?? '読み込みに失敗しました')
    } finally { setLoading(false) }
  }

  useEffect(() => { fetchData() }, [])

  // ── Derived data ──────────────────────────────────────────────────────────
  const nameMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const o of orders) { if (o.product_name && !m.has(o.product_code)) m.set(o.product_code, o.product_name) }
    return m
  }, [orders])

  const sortedProducts = useMemo(() =>
    [...products].sort((a, b) => {
      const ga = GROUP_ORDER.indexOf(a.group_name), gb = GROUP_ORDER.indexOf(b.group_name)
      if (ga !== gb) return ga - gb
      return a.sort_order - b.sort_order
    }), [products])

  // ── SVG refs ──────────────────────────────────────────────────────────────
  const svgRef   = useRef<SVGSVGElement>(null)
  const blindRef = useRef<SVGSVGElement>(null)

  const [cascadeViewMode, setCascadeViewMode] = useState<'blinder' | 'cascade'>('blinder')
  const [revealedCells,   setRevealedCells]   = useState<Set<string>>(new Set())

  function toggleCell(productCode: string, mfgLot: string) {
    const key = `${productCode}|${mfgLot}`
    setRevealedCells(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }
  function isCellRevealed(productCode: string, mfgLot: string) {
    return revealedCells.has(`${productCode}|${mfgLot}`)
  }

  // ── mfg_lots sorted by earliest delivery date, with precise min/max dates ──
  // Each lot's date range is the actual span of delivery_date values among its
  // orders — not inferred from the next lot's start date. This prevents the
  // impossible "7/23～7/22" that occurred when two lots shared a start date.
  const mfgLotSequence = useMemo(() => {
    const minDate = new Map<string, string>()
    const maxDate = new Map<string, string>()
    for (const o of orders) {
      if (!o.mfg_lot_no || !o.delivery_date) continue
      const d = o.delivery_date.slice(0, 10)
      const curMin = minDate.get(o.mfg_lot_no)
      const curMax = maxDate.get(o.mfg_lot_no)
      if (!curMin || d < curMin) minDate.set(o.mfg_lot_no, d)
      if (!curMax || d > curMax) maxDate.set(o.mfg_lot_no, d)
    }
    return Array.from(minDate.keys())
      .sort((a, b) => (minDate.get(a) ?? '').localeCompare(minDate.get(b) ?? ''))
      .map(mfgLot => ({
        mfgLot,
        earliestDate: minDate.get(mfgLot) ?? '',
        latestDate:   maxDate.get(mfgLot) ?? '',
      }))
  }, [orders])

  type LotRow = { mfgLot: string; earliestDate: string; demand: number; opening: number; closing: number; covered: boolean }

  const productCascades = useMemo(() => {
    const result = new Map<string, {
      product: ProductMaster; openingStock: number
      lotRows: LotRow[]
      breakPoint: number | null
    }>()

    for (const p of products) {
      if (!p.group_name) continue

      const CONFIRMED_MAT = new Set(['confirmed', 'delivery_confirmed', 'initial_stock'])
      const groupMaterialPool = new Map<string, number>()
      for (const g of ['M90S','300NP','100G20','950X01']) {
        groupMaterialPool.set(g, materialOrders
          .filter(mo => mo.material_name === g && CONFIRMED_MAT.has(mo.status))
          .reduce((s, mo) => s + mo.quantity_kg, 0))
      }

      const allWeeks = Array.from(new Set(productionPlan.map(pp => pp.week_start_date.slice(0,10)))).sort()
      const materialUsed = new Map<string, number>()
      for (const g of ['M90S','300NP','100G20','950X01']) materialUsed.set(g, 0)

      let feasibleTotal = 0
      for (const wk of allWeeks) {
        const wkPlans = productionPlan
          .filter(pp => pp.week_start_date.slice(0,10) === wk)
          .sort((a, b) => {
            const pa = products.find(pr => pr.product_code === a.product_code)
            const pb = products.find(pr => pr.product_code === b.product_code)
            return (pa?.sort_order ?? 999) - (pb?.sort_order ?? 999)
          })
        for (const pp of wkPlans) {
          const pm = products.find(pr => pr.product_code === pp.product_code)
          if (!pm?.weight_g || !pm.group_name) continue
          const needed = (pp.planned_quantity * pm.weight_g) / 1000
          const pool   = groupMaterialPool.get(pm.group_name) ?? 0
          const used   = materialUsed.get(pm.group_name) ?? 0
          if (used + needed <= pool) {
            materialUsed.set(pm.group_name, used + needed)
            if (pp.product_code === p.product_code) feasibleTotal += pp.planned_quantity
          }
        }
      }
      const openingStock = (p.initial_stock ?? 0) + feasibleTotal

      const demandByLot = new Map<string, number>()
      for (const o of orders) {
        if (o.product_code !== p.product_code || !o.mfg_lot_no) continue
        demandByLot.set(o.mfg_lot_no, (demandByLot.get(o.mfg_lot_no) ?? 0) + o.quantity)
      }
      if (demandByLot.size === 0) continue

      let running = openingStock
      let breakPoint: number | null = null
      const lotRows: LotRow[] = []

      for (const { mfgLot, earliestDate } of mfgLotSequence) {
        const demand = demandByLot.get(mfgLot) ?? 0
        if (demand === 0) continue
        const opening = running, closing = opening - demand, covered = closing >= 0
        if (!covered && breakPoint === null) breakPoint = lotRows.length
        lotRows.push({ mfgLot, earliestDate, demand, opening, closing, covered })
        running = closing
      }

      if (lotRows.length > 0) result.set(p.product_code, { product: p, openingStock, lotRows, breakPoint })
    }
    return result
  }, [products, orders, mfgLotSequence, productionPlan, materialOrders])

  interface GroupLotStatus {
    mfgLot: string; earliestDate: string
    coveredCount: number; totalProducts: number
    failingProducts: { code: string; name: string; shortageUnits: number; shortageKg: number }[]
    totalShortageKg: number; firstFail: boolean
  }

  const groupAnalysis = useMemo(() => {
    const byGroup = new Map<string, GroupLotStatus[]>()
    for (const g of GROUP_ORDER) {
      const gProducts = Array.from(productCascades.values()).filter(c => c.product.group_name === g)
      if (gProducts.length === 0) continue
      const statuses: GroupLotStatus[] = []
      let firstFailFound = false
      for (const { mfgLot, earliestDate } of mfgLotSequence) {
        const ps = gProducts.map(c => ({ c, row: c.lotRows.find(r => r.mfgLot === mfgLot) })).filter(x => x.row)
        if (ps.length === 0) continue
        const failing = ps.filter(x => !x.row!.covered).map(x => {
          const shortage = x.row!.opening > 0 ? (x.row!.demand - x.row!.opening) : x.row!.demand
          const kg = x.c.product.weight_g ? Math.ceil(shortage * x.c.product.weight_g / 1000) : 0
          return { code: x.c.product.product_code, name: nameMap.get(x.c.product.product_code) ?? '', shortageUnits: shortage, shortageKg: kg }
        })
        const isFirst = failing.length > 0 && !firstFailFound
        if (isFirst) firstFailFound = true
        statuses.push({
          mfgLot, earliestDate, totalProducts: ps.length,
          coveredCount: ps.length - failing.length, failingProducts: failing,
          totalShortageKg: failing.reduce((s,f) => s + f.shortageKg, 0), firstFail: isFirst,
        })
      }
      if (statuses.length > 0) byGroup.set(g, statuses)
    }
    return byGroup
  }, [productCascades, mfgLotSequence, nameMap])

  const groupsWithCascade = GROUP_ORDER.filter(g => groupAnalysis.has(g))

  const allCascadeProducts = GROUP_ORDER.flatMap(g =>
    Array.from(productCascades.values())
      .filter(c => c.product.group_name === g)
      .sort((a, b) => a.product.sort_order - b.product.sort_order)
  )

  // ── SVG / Canvas dimension constants ──────────────────────────────────────
  const WF_ROW_H   = 44
  const WF_HDR_H   = 70
  const WF_SEP_H   = 28
  const WF_LABEL_W = 280
  const WF_PER_LOT = 120
  const wfCols     = mfgLotSequence.length
  const wfWidth    = WF_LABEL_W + wfCols * WF_PER_LOT + 40
  const wfHeight   = WF_HDR_H + allCascadeProducts.length * WF_ROW_H + groupsWithCascade.length * WF_SEP_H + 30

  const BL_COL_W   = 110
  const BL_ROW_H   = 44
  const BL_HDR_H   = 56
  const BL_SEP_H   = 22
  const BL_LABEL_W = 280

  const blRows = (() => {
    let n = 0; let pg = ''
    for (const c of allCascadeProducts) {
      if (c.product.group_name !== pg) { n++; pg = c.product.group_name }
      n++
    }
    return n
  })()
  const blWidth  = BL_LABEL_W + mfgLotSequence.length * BL_COL_W
  const blHeight = BL_HDR_H + blRows * BL_ROW_H + 10

  // ── Canvas / export helpers ───────────────────────────────────────────────
  function saveCanvas(canvas: HTMLCanvasElement, filename: string) {
    canvas.toBlob(blob => {
      if (!blob) return
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob); a.download = filename; a.click()
    }, 'image/png')
  }

  function drawColorMapCanvas(showRevealed: boolean): HTMLCanvasElement {
    const SC = 2
    const W = blWidth, H = blHeight
    const canvas = document.createElement('canvas')
    canvas.width = W * SC; canvas.height = H * SC
    const ctx = canvas.getContext('2d')!
    ctx.scale(SC, SC)
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H)

    // Header
    ctx.fillStyle = '#1f2937'; ctx.fillRect(0, 0, W, BL_HDR_H)
    ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left'
    ctx.fillText('品番 / 品名', 12, BL_HDR_H / 2)

    mfgLotSequence.forEach(({ mfgLot, earliestDate, latestDate }, i) => {
      const x = BL_LABEL_W + i * BL_COL_W
      const anyFail = GROUP_ORDER.some(g =>
        (groupAnalysis.get(g) ?? []).some(gs => gs.mfgLot === mfgLot && gs.failingProducts.length > 0))
      ctx.strokeStyle = '#4b5563'
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, BL_HDR_H); ctx.stroke()
      ctx.fillStyle = anyFail ? '#fca5a5' : '#fff'
      ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'
      ctx.fillText(mfgLot, x + BL_COL_W / 2, BL_HDR_H / 2 - 8)
      ctx.fillStyle = '#9ca3af'; ctx.font = '9px sans-serif'
      const dateLabel = latestDate && latestDate !== earliestDate
        ? `${fmtDate(earliestDate)}〜${fmtDate(latestDate)}`
        : fmtDate(earliestDate)
      ctx.fillText(dateLabel, x + BL_COL_W / 2, BL_HDR_H / 2 + 8)
      ctx.textAlign = 'left'
    })

    const GROUP_SEP_FILL: Record<string, string> = {
      'M90S':'#1e3a8a','300NP':'#14532d','100G20':'#7f1d1d','950X01':'#4c1d95'
    }
    let y = BL_HDR_H; let prevG = ''; let ri = 0

    for (const cascade of allCascadeProducts) {
      const p = cascade.product; const g = p.group_name
      const pName = nameMap.get(p.product_code) ?? ''

      if (g !== prevG) {
        ctx.fillStyle = GROUP_SEP_FILL[g] ?? '#374151'
        ctx.fillRect(0, y, W, BL_SEP_H)
        ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif'
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
        ctx.fillText(g, 12, y + BL_SEP_H / 2)
        y += BL_SEP_H; prevG = g
      }

      ctx.fillStyle = ri % 2 === 0 ? '#fff' : '#f9fafb'
      ctx.fillRect(0, y, W, BL_ROW_H)
      ctx.strokeStyle = '#f3f4f6'
      ctx.beginPath(); ctx.moveTo(0, y + BL_ROW_H); ctx.lineTo(W, y + BL_ROW_H); ctx.stroke()
      ctx.fillStyle = '#6b7280'; ctx.font = '9px monospace'
      ctx.textAlign = 'left'; ctx.textBaseline = 'top'
      ctx.fillText(p.product_code, 12, y + 5)
      ctx.fillStyle = '#111827'; ctx.font = '11px sans-serif'
      ctx.fillText(pName, 12, y + 20)

      mfgLotSequence.forEach(({ mfgLot }, i) => {
        const lf = cascade.lotRows.find(r => r.mfgLot === mfgLot)
        const x  = BL_LABEL_W + i * BL_COL_W
        ctx.strokeStyle = '#e5e7eb'
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + BL_ROW_H); ctx.stroke()

        if (!lf) {
          ctx.fillStyle = '#d1d5db'; ctx.font = '10px sans-serif'
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
          ctx.fillText('—', x + BL_COL_W / 2, y + BL_ROW_H / 2)
          ctx.textAlign = 'left'; return
        }

        const remainPct = cascade.openingStock > 0 ? lf.closing / cascade.openingStock : 0
        const bg     = !lf.covered ? '#fee2e2' : remainPct < 0.10 ? '#fefce8' : '#f0fdf4'
        const txtCol = !lf.covered ? '#b91c1c' : remainPct < 0.10 ? '#92400e' : '#374151'
        ctx.fillStyle = bg; ctx.fillRect(x + 1, y + 1, BL_COL_W - 2, BL_ROW_H - 2)

        const revealed = showRevealed && isCellRevealed(p.product_code, mfgLot)
        const weightG  = p.weight_g ?? 0
        const canFill  = Math.max(0, lf.opening)
        const shortage = Math.max(0, lf.demand - canFill)
        const sKg      = weightG > 0 ? (Math.round(shortage * weightG / 100) / 10).toLocaleString() : null

        if (revealed) {
          const barW   = BL_COL_W - 16
          const cPct   = lf.demand > 0 ? canFill / lf.demand : 0
          const greenW = Math.round(cPct * barW)
          const label  = lf.covered
            ? `残${lf.closing.toLocaleString()}`
            : sKg ? `不足${shortage.toLocaleString()}(${sKg}kg)` : `不足${shortage.toLocaleString()}`
          ctx.fillStyle = '#6b7280'; ctx.font = '8px sans-serif'
          ctx.textAlign = 'center'; ctx.textBaseline = 'top'
          ctx.fillText('-' + lf.demand.toLocaleString(), x + BL_COL_W / 2, y + 5)
          ctx.fillStyle = '#e5e7eb'; ctx.fillRect(x + 8, y + 17, barW, 5)
          if (lf.covered) {
            ctx.fillStyle = remainPct < 0.10 ? '#f59e0b' : '#10b981'
            ctx.fillRect(x + 8, y + 17, barW, 5)
          } else {
            if (greenW > 0) { ctx.fillStyle = '#10b981'; ctx.fillRect(x + 8, y + 17, greenW, 5) }
            ctx.fillStyle = '#ef4444'; ctx.fillRect(x + 8 + greenW, y + 17, barW - greenW, 5)
          }
          ctx.fillStyle = lf.covered ? '#059669' : '#b91c1c'
          ctx.font = 'bold 8px sans-serif'; ctx.textBaseline = 'bottom'
          ctx.fillText(label, x + BL_COL_W / 2, y + BL_ROW_H - 4)
          ctx.textAlign = 'left'
        } else {
          const bold = !lf.covered || remainPct < 0.10
          ctx.fillStyle = txtCol
          ctx.font = (bold ? 'bold ' : '') + '11px sans-serif'
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
          ctx.fillText(lf.demand.toLocaleString(), x + BL_COL_W / 2, y + BL_ROW_H / 2)
          ctx.textAlign = 'left'
        }
      })
      y += BL_ROW_H; ri++
    }
    return canvas
  }

  function exportPNG() {
    if (!svgRef.current) return
    const clone = svgRef.current.cloneNode(true) as SVGSVGElement
    clone.setAttribute('width', String(wfWidth))
    clone.setAttribute('height', String(wfHeight))
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }))
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = wfWidth * 2; canvas.height = wfHeight * 2
      const ctx = canvas.getContext('2d')!
      ctx.scale(2, 2); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, wfWidth, wfHeight)
      ctx.drawImage(img, 0, 0); URL.revokeObjectURL(url)
      saveCanvas(canvas, `充足カスケード_カスケードPNG_${new Date().toISOString().slice(0,10)}.png`)
    }
    img.src = url
  }
  function exportBlinderPNG() {
    saveCanvas(drawColorMapCanvas(false), `充足カスケード_カラーマップ_${new Date().toISOString().slice(0,10)}.png`)
  }
  function exportCurrentPNG() {
    saveCanvas(drawColorMapCanvas(true), `充足カスケード_現在状態_${new Date().toISOString().slice(0,10)}.png`)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="h-full overflow-auto p-4 space-y-8">
      {loading ? (
        <div className="text-center py-20 text-sm text-gray-400">読み込み中...</div>
      ) : error ? (
        <div className="text-center py-20">
          <p className="text-sm text-red-500 mb-3">{error}</p>
          <button onClick={fetchData} className="text-sm text-blue-600 border border-blue-200 rounded-lg px-4 py-2">再試行</button>
        </div>
      ) : groupsWithCascade.length > 0 && (
        <div className="space-y-5">

          {/* Section header */}
          <div className="flex items-end justify-between mb-2">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">品番別 在庫カスケード</h2>
              <p className="text-sm text-gray-500 mt-0.5">各製造番号の需要を順に消化した場合の在庫残高推移</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <button onClick={fetchData}
                className="text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5">
                更新
              </button>
              <div className="flex items-center gap-3 text-[11px] text-gray-400 mr-2">
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-emerald-400"/>充足</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-amber-400"/>残少</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-red-500"/>不足</span>
              </div>
              <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
                <button onClick={() => setCascadeViewMode('blinder')}
                  className={`px-3 py-1.5 transition-colors ${cascadeViewMode === 'blinder' ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                  🎨 カラーマップ
                </button>
                <button onClick={() => setCascadeViewMode('cascade')}
                  className={`px-3 py-1.5 border-l border-gray-200 transition-colors ${cascadeViewMode === 'cascade' ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                  📊 詳細カスケード
                </button>
              </div>
              <button onClick={exportPNG}
                className="text-xs font-medium text-white bg-gray-700 hover:bg-gray-800 rounded-lg px-3 py-1.5 transition-colors">
                📥 カスケードPNG
              </button>
              <button onClick={exportBlinderPNG}
                className="text-xs font-medium text-white bg-gray-500 hover:bg-gray-600 rounded-lg px-3 py-1.5 transition-colors">
                📥 マップPNG
              </button>
              <button onClick={exportCurrentPNG}
                className="text-xs font-medium text-white bg-gray-400 hover:bg-gray-500 rounded-lg px-3 py-1.5 transition-colors">
                📥 現在状態PNG
              </button>
            </div>
          </div>

          {cascadeViewMode === 'blinder' && (
            <p className="text-[11px] text-gray-400 -mt-2">
              💡 各セルをクリックすると詳細カスケードが表示されます。もう一度クリックで非表示。
            </p>
          )}

          {/* ── COLOR MAP ────────────────────────────────────────────────── */}
          <div style={{ display: cascadeViewMode === 'blinder' ? 'block' : 'none' }}
            className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <svg ref={blindRef} width={blWidth} height={blHeight}
                style={{ display: 'block', minWidth: '100%' }} xmlns="http://www.w3.org/2000/svg">
                <rect width={blWidth} height={blHeight} fill="#fff"/>

                {/* Header */}
                <rect x={0} y={0} width={blWidth} height={BL_HDR_H} fill="#1f2937"/>
                <text x={12} y={BL_HDR_H/2 + 5} fontSize={12} fontWeight={700} fill="#fff">品番 / 品名</text>

                {mfgLotSequence.map(({ mfgLot, earliestDate, latestDate }, i) => {
                  const x = BL_LABEL_W + i * BL_COL_W
                  const anyFail = GROUP_ORDER.some(g => (groupAnalysis.get(g) ?? []).find(gs => gs.mfgLot === mfgLot && gs.failingProducts.length > 0))
                  // Show "start〜end" only when the lot spans multiple dates
                  const dateLabel = latestDate && latestDate !== earliestDate
                    ? `${fmtDate(earliestDate)}〜${fmtDate(latestDate)}`
                    : fmtDate(earliestDate)
                  return (
                    <g key={mfgLot}>
                      <line x1={x} y1={0} x2={x} y2={BL_HDR_H} stroke="#4b5563"/>
                      <text x={x + BL_COL_W/2} y={BL_HDR_H/2 - 4} textAnchor="middle"
                        fontSize={10} fontWeight={700} fill={anyFail ? '#fca5a5' : '#fff'}>{mfgLot}</text>
                      <text x={x + BL_COL_W/2} y={BL_HDR_H/2 + 12} textAnchor="middle"
                        fontSize={9} fill="#9ca3af">{dateLabel}</text>
                    </g>
                  )
                })}

                {/* Product rows */}
                {(() => {
                  const rows: React.ReactNode[] = []
                  let y = BL_HDR_H; let prevGroup = ''; let rowIdx = 0
                  const GROUP_SEP_FILL: Record<string, string> = {
                    'M90S': '#1e3a8a', '300NP': '#14532d', '100G20': '#7f1d1d', '950X01': '#4c1d95'
                  }
                  for (const cascade of allCascadeProducts) {
                    const p = cascade.product; const g = p.group_name
                    const pName = nameMap.get(p.product_code) ?? ''

                    if (g !== prevGroup) {
                      rows.push(
                        <g key={`sep-${g}`}>
                          <rect x={0} y={y} width={blWidth} height={BL_SEP_H} fill={GROUP_SEP_FILL[g] ?? '#374151'}/>
                          <text x={12} y={y + BL_SEP_H/2 + 5} fontSize={11} fontWeight={700} fill="#fff">{g}</text>
                        </g>
                      )
                      y += BL_SEP_H; prevGroup = g
                    }

                    rows.push(
                      <g key={p.product_code}>
                        <rect x={0} y={y} width={blWidth} height={BL_ROW_H} fill={rowIdx % 2 === 0 ? '#fff' : '#f9fafb'}/>
                        <line x1={0} y1={y + BL_ROW_H} x2={blWidth} y2={y + BL_ROW_H} stroke="#f3f4f6"/>
                        <text x={12} y={y + 14} fontSize={9} fill="#6b7280" fontFamily="monospace">{p.product_code}</text>
                        <text x={12} y={y + 30} fontSize={11} fill="#111827">{pName}</text>

                        {mfgLotSequence.map(({ mfgLot }, li) => {
                          const lf = cascade.lotRows.find(r => r.mfgLot === mfgLot)
                          const x  = BL_LABEL_W + li * BL_COL_W
                          if (!lf) return (
                            <g key={mfgLot}>
                              <line x1={x} y1={y} x2={x} y2={y + BL_ROW_H} stroke="#e5e7eb"/>
                              <text x={x + BL_COL_W/2} y={y + BL_ROW_H/2 + 4} textAnchor="middle" fontSize={10} fill="#d1d5db">—</text>
                            </g>
                          )
                          const remainPct = cascade.openingStock > 0 ? lf.closing / cascade.openingStock : 0
                          const bg        = !lf.covered ? '#fee2e2' : remainPct < 0.10 ? '#fefce8' : '#f0fdf4'
                          const txtCol    = !lf.covered ? '#b91c1c' : remainPct < 0.10 ? '#92400e' : '#374151'
                          const bold      = !lf.covered || remainPct < 0.10
                          const revealed  = isCellRevealed(p.product_code, mfgLot)
                          const weightG   = p.weight_g ?? 0
                          const canFill   = Math.max(0, lf.opening)
                          const shortage  = Math.max(0, lf.demand - canFill)
                          const shortageKg = weightG > 0 ? (Math.round(shortage * weightG / 100) / 10).toLocaleString() : null

                          if (revealed) {
                            const maxBar   = BL_COL_W - 16
                            const coverPct = lf.demand > 0 ? canFill / lf.demand : 0
                            const greenW   = Math.round(coverPct * maxBar)
                            const label    = lf.covered
                              ? `残${lf.closing.toLocaleString()}`
                              : shortageKg ? `不足${shortage.toLocaleString()}(${shortageKg}kg)` : `不足${shortage.toLocaleString()}`
                            return (
                              <g key={mfgLot} onClick={() => toggleCell(p.product_code, mfgLot)} style={{ cursor: 'pointer' }}>
                                <rect x={x+1} y={y+1} width={BL_COL_W-2} height={BL_ROW_H-2} fill={bg}/>
                                <line x1={x} y1={y} x2={x} y2={y + BL_ROW_H} stroke="#e5e7eb"/>
                                <text x={x + BL_COL_W/2} y={y + 11} textAnchor="middle" fontSize={8} fill="#6b7280">
                                  -{lf.demand.toLocaleString()}
                                </text>
                                <rect x={x+8} y={y+14} width={maxBar} height={5} fill="#e5e7eb" rx={2}/>
                                {lf.covered ? (
                                  <rect x={x+8} y={y+14} width={maxBar} height={5} fill={remainPct < 0.10 ? '#f59e0b' : '#10b981'} rx={2}/>
                                ) : (
                                  <g>
                                    {greenW > 0 && <rect x={x+8} y={y+14} width={greenW} height={5} fill="#10b981" rx={2}/>}
                                    <rect x={x+8+greenW} y={y+14} width={maxBar-greenW} height={5} fill="#ef4444" rx={2}/>
                                  </g>
                                )}
                                <text x={x + BL_COL_W/2} y={y + 34} textAnchor="middle"
                                  fontSize={8} fontWeight={700} fill={lf.covered ? '#059669' : '#b91c1c'}>
                                  {label}
                                </text>
                              </g>
                            )
                          }
                          return (
                            <g key={mfgLot} onClick={() => toggleCell(p.product_code, mfgLot)} style={{ cursor: 'pointer' }}>
                              <rect x={x+1} y={y+1} width={BL_COL_W-2} height={BL_ROW_H-2} fill={bg}/>
                              <line x1={x} y1={y} x2={x} y2={y + BL_ROW_H} stroke="#e5e7eb"/>
                              <text x={x + BL_COL_W/2} y={y + BL_ROW_H/2 + 4}
                                textAnchor="middle" fontSize={11} fontWeight={bold ? 700 : 400} fill={txtCol}>
                                {lf.demand.toLocaleString()}
                              </text>
                            </g>
                          )
                        })}
                      </g>
                    )
                    y += BL_ROW_H; rowIdx++
                  }
                  return rows
                })()}
              </svg>
            </div>
            <div className="px-4 py-2 border-t border-gray-100 text-[11px] text-gray-400">
              🟢 充足 &nbsp; 🟡 残少(10%未満) &nbsp; 🔴 不足 — 📥 マップPNGで書き出し
            </div>
          </div>

          {/* ── CASCADE DETAIL ───────────────────────────────────────────── */}
          <div style={{ display: cascadeViewMode === 'cascade' ? 'block' : 'none' }}
            className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <svg ref={svgRef} width={wfWidth} height={wfHeight} style={{ display: 'block', minWidth: '100%' }}>
                <rect width={wfWidth} height={wfHeight} fill="#fff"/>

                {mfgLotSequence.map((s, i) => {
                  const x = WF_LABEL_W + i * WF_PER_LOT
                  const anyFail = GROUP_ORDER.some(g => (groupAnalysis.get(g) ?? []).find(gs => gs.mfgLot === s.mfgLot && gs.failingProducts.length > 0))
                  const dateLabel = s.latestDate && s.latestDate !== s.earliestDate
                    ? `${fmtDate(s.earliestDate)}〜${fmtDate(s.latestDate)}`
                    : fmtDate(s.earliestDate)
                  return (
                    <g key={s.mfgLot}>
                      {anyFail && <rect x={x} y={WF_HDR_H - 24} width={WF_PER_LOT} height={wfHeight - WF_HDR_H + 24 - 20} fill="#FEF2F2" opacity={0.4}/>}
                      <line x1={x} y1={20} x2={x} y2={wfHeight - 10} stroke="#E5E7EB" strokeDasharray="3 3"/>
                      <text x={x + WF_PER_LOT/2} y={34} textAnchor="middle" fontSize={11} fontWeight={700}
                        fill={anyFail ? '#DC2626' : '#374151'}>{s.mfgLot}</text>
                      <text x={x + WF_PER_LOT/2} y={48} textAnchor="middle" fontSize={9} fill="#9CA3AF">{dateLabel}</text>
                      {anyFail && (() => {
                        const totalFailing = GROUP_ORDER.reduce((sum, g) => {
                          const gs = (groupAnalysis.get(g) ?? []).find(x => x.mfgLot === s.mfgLot)
                          return sum + (gs?.failingProducts.length ?? 0)
                        }, 0)
                        return (
                          <g>
                            <rect x={x + WF_PER_LOT/2 - 18} y={53} width={36} height={12} rx={6} fill="#FEE2E2"/>
                            <text x={x + WF_PER_LOT/2} y={62} textAnchor="middle" fontSize={8} fontWeight={700} fill="#B91C1C">
                              ⚠ {totalFailing}件
                            </text>
                          </g>
                        )
                      })()}
                    </g>
                  )
                })}

                <text x={WF_LABEL_W - 12} y={34} textAnchor="end" fontSize={11} fontWeight={600} fill="#374151">品番 / 品名</text>
                <text x={WF_LABEL_W - 12} y={50} textAnchor="end" fontSize={9} fill="#9CA3AF">開始在庫 (初期+製造計画)</text>

                {(() => {
                  const rows: React.ReactNode[] = []
                  let yOffset = WF_HDR_H; let prevGroup = ''; let productRowIdx = 0

                  for (const cascade of allCascadeProducts) {
                    const p = cascade.product; const g = p.group_name

                    if (g !== prevGroup) {
                      const sepFill = g === 'M90S' ? '#1e3a5f' : g === '300NP' ? '#14532d' : g === '100G20' ? '#7f1d1d' : '#4c1d95'
                      rows.push(
                        <g key={`sep-${g}`}>
                          <rect x={0} y={yOffset} width={wfWidth} height={WF_SEP_H} fill={sepFill}/>
                          <text x={12} y={yOffset + WF_SEP_H / 2 + 5} fontSize={12} fontWeight={700} fill="#fff">{g}</text>
                        </g>
                      )
                      yOffset += WF_SEP_H; prevGroup = g
                    }

                    const y = yOffset; const cy = y + WF_ROW_H / 2
                    const pName = nameMap.get(p.product_code) ?? p.product_code.slice(-8)

                    rows.push(
                      <g key={p.product_code}>
                        {productRowIdx % 2 === 0 && <rect x={0} y={y} width={wfWidth} height={WF_ROW_H} fill="#F9FAFB"/>}
                        <text x={WF_LABEL_W - 12} y={cy - 6} textAnchor="end" fontSize={9} fill="#9CA3AF" fontFamily="monospace">{p.product_code}</text>
                        <text x={WF_LABEL_W - 12} y={cy + 8} textAnchor="end" fontSize={11} fontWeight={500} fill="#111827">{pName}</text>
                        <text x={WF_LABEL_W - 12} y={cy + 20} textAnchor="end" fontSize={9} fill="#9CA3AF">{cascade.openingStock.toLocaleString()} pcs</text>

                        {mfgLotSequence.map((gs, li) => {
                          const lf     = cascade.lotRows.find(r => r.mfgLot === gs.mfgLot)
                          const x      = WF_LABEL_W + li * WF_PER_LOT
                          const maxBar = WF_PER_LOT - 20
                          if (!lf) return (
                            <text key={gs.mfgLot} x={x + WF_PER_LOT/2} y={cy + 4} textAnchor="middle" fontSize={10} fill="#E5E7EB">—</text>
                          )

                          const weightG    = p.weight_g ?? 0
                          const canFill    = Math.max(0, lf.opening)
                          const shortage   = Math.max(0, lf.demand - canFill)
                          const shortageKg = weightG > 0 ? (Math.round(shortage * weightG / 100) / 10).toLocaleString() : null

                          if (lf.covered) {
                            const remainPct = cascade.openingStock > 0 ? lf.closing / cascade.openingStock : 1
                            const barCol = remainPct < 0.10 ? '#F59E0B' : '#10B981'
                            return (
                              <g key={gs.mfgLot}>
                                <rect x={x + 10} y={cy - 9} width={maxBar} height={8} fill={barCol} opacity={0.85} rx={4}/>
                                <text x={x + WF_PER_LOT/2} y={cy - 12} textAnchor="middle" fontSize={9} fill="#6B7280" fontWeight={600}>-{lf.demand.toLocaleString()}</text>
                                <text x={x + WF_PER_LOT/2} y={cy + 12} textAnchor="middle" fontSize={9} fill="#059669" fontWeight={500}>残{lf.closing.toLocaleString()}</text>
                              </g>
                            )
                          } else {
                            const coverPct = lf.demand > 0 ? canFill / lf.demand : 0
                            const greenW   = Math.round(coverPct * maxBar)
                            const redW     = maxBar - greenW
                            const labelBelow = shortageKg ? `不足${shortage.toLocaleString()}(${shortageKg}kg)` : `不足${shortage.toLocaleString()}`
                            return (
                              <g key={gs.mfgLot}>
                                <rect x={x + 10} y={cy - 9} width={maxBar} height={8} fill="#E5E7EB" rx={4}/>
                                {greenW > 0 && <rect x={x + 10} y={cy - 9} width={greenW} height={8} fill="#10B981" opacity={0.7} rx={4}/>}
                                {redW > 0 && <rect x={x + 10 + greenW} y={cy - 9} width={redW} height={8} fill="#EF4444" opacity={0.85} rx={4}/>}
                                {redW > 24 && (
                                  <text x={x + 10 + greenW + redW / 2} y={cy - 3} textAnchor="middle" fontSize={7} fill="#fff" fontWeight={700}>
                                    {Math.round((1 - coverPct) * 100)}%
                                  </text>
                                )}
                                <text x={x + WF_PER_LOT/2} y={cy - 12} textAnchor="middle" fontSize={9} fill="#B91C1C" fontWeight={600}>-{lf.demand.toLocaleString()}</text>
                                <text x={x + WF_PER_LOT/2} y={cy + 12} textAnchor="middle" fontSize={8} fill="#B91C1C" fontWeight={700}>{labelBelow}</text>
                              </g>
                            )
                          }
                        })}

                        {cascade.breakPoint !== null && (() => {
                          const bpLot = cascade.lotRows[cascade.breakPoint].mfgLot
                          const li    = mfgLotSequence.findIndex(s => s.mfgLot === bpLot)
                          if (li < 0) return null
                          const bpX = WF_LABEL_W + li * WF_PER_LOT
                          return <line x1={bpX} y1={y + 3} x2={bpX} y2={y + WF_ROW_H - 3} stroke="#DC2626" strokeWidth={2} strokeDasharray="4 2"/>
                        })()}
                      </g>
                    )
                    yOffset += WF_ROW_H; productRowIdx++
                  }
                  return rows
                })()}

                <text x={WF_LABEL_W} y={wfHeight - 6} fontSize={9} fill="#9CA3AF">赤い点線 = 在庫が尽きるブレーク点</text>
              </svg>
            </div>
          </div>

          {/* Rebalancing table */}
          {(() => {
            const allFailing = mfgLotSequence.flatMap(({ mfgLot, earliestDate }) => {
              const failingProducts: { code: string; name: string; shortageUnits: number; shortageKg: number }[] = []
              for (const g of GROUP_ORDER) {
                const gs = (groupAnalysis.get(g) ?? []).find(s => s.mfgLot === mfgLot)
                if (gs) failingProducts.push(...gs.failingProducts)
              }
              if (failingProducts.length === 0) return []
              const totalShortageKg = failingProducts.reduce((s, f) => s + f.shortageKg, 0)
              const firstFail = GROUP_ORDER.some(g => (groupAnalysis.get(g) ?? []).find(s => s.mfgLot === mfgLot && s.firstFail))
              return [{ mfgLot, earliestDate, failingProducts, totalShortageKg, firstFail }]
            })

            if (allFailing.length === 0) return (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 flex items-start gap-3">
                <span className="text-2xl">✅</span>
                <div>
                  <p className="text-sm font-semibold text-emerald-900">全グループで全製造番号が充足しています</p>
                  <p className="text-xs text-emerald-700 mt-1">追加の材料発注や生産調整は不要です。</p>
                </div>
              </div>
            )
            return (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-100 bg-amber-50/40">
                  <h3 className="text-sm font-semibold text-gray-800">📋 追加生産・材料発注の推奨</h3>
                  <p className="text-[11px] text-gray-500 mt-0.5">不足している製造番号と、解消に必要な追加材料量</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="px-4 py-2.5 text-left font-medium text-gray-600 whitespace-nowrap">製造番号</th>
                        <th className="px-4 py-2.5 text-left font-medium text-gray-600 whitespace-nowrap">初回納期</th>
                        <th className="px-4 py-2.5 text-left font-medium text-gray-600">不足品番 (追加必要数 / 材料)</th>
                        <th className="px-4 py-2.5 text-right font-medium text-gray-600 whitespace-nowrap">合計材料</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {allFailing.map(s => (
                        <tr key={s.mfgLot} className={s.firstFail ? 'bg-red-50/40' : ''}>
                          <td className="px-4 py-3 align-top">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-gray-900">{s.mfgLot}</span>
                              {s.firstFail && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold">最初のブレーク点</span>}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-gray-500 align-top whitespace-nowrap">{fmtDate(s.earliestDate)}〜</td>
                          <td className="px-4 py-3 align-top">
                            <div className="space-y-1.5">
                              {s.failingProducts.map(f => (
                                <div key={f.code} className="flex items-center gap-2">
                                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0"/>
                                  <span className="font-medium text-gray-800">{f.name || f.code.slice(-8)}</span>
                                  <span className="text-gray-400">—</span>
                                  <span className="text-red-700 font-semibold tabular-nums">+{f.shortageUnits.toLocaleString()}個</span>
                                  <span className="text-gray-300">/</span>
                                  <span className="text-amber-700 font-medium tabular-nums">{f.shortageKg.toLocaleString()}kg</span>
                                </div>
                              ))}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right align-top whitespace-nowrap font-bold text-red-700 tabular-nums">
                            {Math.ceil(s.totalShortageKg).toLocaleString()} kg
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-gray-50 border-t-2 border-gray-300">
                        <td colSpan={3} className="px-4 py-2.5 text-right font-semibold text-gray-700">累計追加材料必要量</td>
                        <td className="px-4 py-2.5 text-right font-bold text-red-700 tabular-nums">
                          {Math.ceil(allFailing.reduce((s, st) => s + st.totalShortageKg, 0)).toLocaleString()} kg
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}