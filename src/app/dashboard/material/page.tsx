'use client'

import { useEffect, useState, useMemo } from 'react'
import { useAuth } from '@/lib/auth-context'
import { useStock } from '@/lib/stock-context'
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
         AlignmentType, BorderStyle, WidthType, ShadingType, VerticalAlign } from 'docx'

// ── Types ────────────────────────────────────────────────────────────────────
interface MaterialOrder {
  id: string; material_name: string; quantity_kg: number
  delivery_date: string; order_date: string; status: Status
  note: string | null; trading_company: string | null
}
interface ProductMaster {
  id: string; product_code: string; group_name: string
  weight_g: number | null; initial_stock: number | null
}
interface ProductionPlan {
  id: string; product_code: string; week_start_date: string; planned_quantity: number
}
interface LotDef {
  id: string; lot_id: string; lot_label: string; start_from: string; sort_order: number
}
interface ShipmentOrder {
  id: string; product_code: string; product_name?: string
  lot_number: string; quantity: number; delivery_date: string
}
type Status = 'initial_stock' | 'pending' | 'ordered' | 'confirmed' | 'delivery_confirmed' | 'delayed'


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

const STATUS_CONFIG: Record<Status, { label: string; color: string; bg: string; border: string; dot: string }> = {
  initial_stock:      { label: '初期在庫',      color: 'text-gray-800',  bg: 'bg-gray-200',  border: 'border-gray-400',  dot: 'bg-gray-600' },
  pending:            { label: '保留中',        color: 'text-gray-600',  bg: 'bg-gray-100',  border: 'border-gray-300',  dot: 'bg-gray-400' },
  ordered:            { label: '発注済・確認待', color: 'text-amber-700', bg: 'bg-amber-50',  border: 'border-amber-300', dot: 'bg-amber-400' },
  confirmed:          { label: '確認済',        color: 'text-blue-700',  bg: 'bg-blue-50',   border: 'border-blue-300',  dot: 'bg-blue-500' },
  delivery_confirmed: { label: '納入確定',      color: 'text-green-700', bg: 'bg-green-50',  border: 'border-green-300', dot: 'bg-green-500' },
  delayed:            { label: '遅延',          color: 'text-red-700',   bg: 'bg-red-50',    border: 'border-red-300',   dot: 'bg-red-500' },
}
const STATUS_ORDER: Status[] = ['initial_stock','pending','ordered','confirmed','delivery_confirmed','delayed']
const PURCHASE_STATUSES: Status[] = ['pending','ordered','confirmed','delivery_confirmed','delayed']
const GROUP_ORDER = ['M90S','300NP','100G20','950X01']
const GROUP_STYLES: Record<string, { badge: string; rowBg: string; color: string }> = {
  'M90S':   { badge: 'bg-blue-50 text-blue-700',     rowBg: 'bg-blue-50/10',   color: 'text-blue-700' },
  '300NP':  { badge: 'bg-green-50 text-green-700',   rowBg: 'bg-green-50/10',  color: 'text-green-700' },
  '100G20': { badge: 'bg-red-50 text-red-700',       rowBg: 'bg-red-50/10',    color: 'text-red-700' },
  '950X01': { badge: 'bg-purple-50 text-purple-700', rowBg: 'bg-purple-50/10', color: 'text-purple-700' },
}
const TRADING_COMPANIES = ['佐藤セル','大成','三井物産プラ','その他']
const TRADING_COMPANY_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  '佐藤セル':    { bg: 'bg-sky-50',    text: 'text-sky-700',    border: 'border-sky-200' },
  '大成':        { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
  '三井物産プラ': { bg: 'bg-teal-50',  text: 'text-teal-700',   border: 'border-teal-200' },
  'その他':      { bg: 'bg-gray-50',   text: 'text-gray-600',   border: 'border-gray-200' },
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
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function getWeekEndStr(mon: string): string {
  for (let i = 4; i >= 0; i--) {
    const d = new Date(mon + 'T00:00:00'); d.setDate(d.getDate() + i)
    const s = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    if (isBusinessDay(s)) return s
  }
  return mon
}
function addDaysStr(s: string, n: number): string {
  const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function generateWeeks(startDate: string, weeks: number): string[] {
  const result: string[] = []; let current = getMondayStr(startDate)
  for (let i = 0; i < weeks; i++) { result.push(current); current = addDaysStr(current, 7) }
  return result
}
function formatWeekLabel(mondayStr: string): string {
  const end = getWeekEndStr(mondayStr)
  const m1 = new Date(mondayStr+'T00:00:00').getMonth()+1, d1 = new Date(mondayStr+'T00:00:00').getDate()
  const m2 = new Date(end+'T00:00:00').getMonth()+1,       d2 = new Date(end+'T00:00:00').getDate()
  return m1===m2 ? `${m1}/${d1}–${d2}` : `${m1}/${d1}–${m2}/${d2}`
}
function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function toDateKey(iso: string): string { return iso ? iso.slice(0,10) : '' }
function formatDate(d: string): string {
  if (!d) return ''; const dt = new Date(d+'T00:00:00')
  return `${dt.getMonth()+1}/${dt.getDate()}`
}
function formatDateFull(d: string): string {
  if (!d) return ''; const dt = new Date(d+'T00:00:00')
  return `${dt.getFullYear()}/${dt.getMonth()+1}/${dt.getDate()}`
}
function balanceStyle(balance: number): { bg: string; text: string } {
  if (balance < 0)    return { bg: 'bg-red-100',   text: 'text-red-800' }
  if (balance < 2000) return { bg: 'bg-yellow-50', text: 'text-yellow-800' }
  return                     { bg: 'bg-green-50',  text: 'text-green-800' }
}

function TradingTag({ name }: { name: string | null }) {
  if (!name) return null
  const s = TRADING_COMPANY_STYLES[name] ?? TRADING_COMPANY_STYLES['その他']
  return <span className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded border ${s.bg} ${s.text} ${s.border}`}>{name}</span>
}
function StatusBadge({ status }: { status: Status }) {
  const s = STATUS_CONFIG[status]
  return <span className={`inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded-full ${s.bg} ${s.color}`}><span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />{s.label}</span>
}

function OrderCell({ order, onClick, onAllocate }: { order: MaterialOrder; onClick: () => void; onAllocate?: () => void }) {
  const s = STATUS_CONFIG[order.status]
  return (
    <div className={`rounded-lg border mb-1 last:mb-0 ${s.bg} ${s.border}`}>
      <button onClick={onClick} className={`w-full text-left px-2 py-1.5 transition-all hover:brightness-95 ${s.color}`}>
        <div className="flex items-center justify-between gap-1 mb-0.5">
          <span className="font-semibold text-xs tabular-nums">{order.quantity_kg.toLocaleString()} kg</span>
          <TradingTag name={order.trading_company} />
        </div>
        <div className={`text-[10px] flex items-center gap-1 ${s.color} opacity-80`}>
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot}`} />{s.label}
        </div>
      </button>
      {onAllocate && (
        <button onClick={onAllocate} className="w-full text-[10px] text-center py-1 border-t border-current/10 text-blue-600 hover:bg-blue-50 transition-colors rounded-b-lg font-medium">
          🤖 AI配分アドバイス
        </button>
      )}
    </div>
  )
}

function AdviceRenderer({ advice }: { advice: string }) {
  if (!advice) return null
  const html = (s: string) => s.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/`(.*?)`/g,'<code class="bg-gray-100 px-1 rounded text-xs">$1</code>')
  const lines = advice.split('\n')
  const blocks: { type: string; lines: string[] }[] = []
  for (const line of lines) {
    const isTableLine = line.trim().startsWith('|')
    if (isTableLine) {
      if (blocks.length > 0 && blocks[blocks.length-1].type==='table') blocks[blocks.length-1].lines.push(line)
      else blocks.push({ type:'table', lines:[line] })
    } else blocks.push({ type:'line', lines:[line] })
  }
  return (
    <div className="text-sm text-gray-700 leading-relaxed space-y-1.5">
      {blocks.map((block, bi) => {
        if (block.type==='table') {
          const rows = block.lines.map(l=>l.split('|').filter(c=>c.trim()!=='')).filter(cells=>!cells.every(c=>/^[-:\s]+$/.test(c)))
          if (rows.length===0) return null
          const [header,...body] = rows
          return (
            <div key={bi} className="my-3 rounded-lg border border-gray-200 overflow-hidden">
              <table className="w-full text-xs border-collapse">
                <thead><tr className="bg-gray-50 border-b border-gray-200">{header.map((cell,j)=><th key={j} className="px-3 py-2 text-left font-semibold text-gray-700 whitespace-normal" dangerouslySetInnerHTML={{__html:html(cell.trim())}}/>)}</tr></thead>
                <tbody>{body.map((row,ri)=><tr key={ri} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">{row.map((cell,j)=><td key={j} className="px-3 py-2 text-gray-700 align-top whitespace-normal" dangerouslySetInnerHTML={{__html:html(cell.trim())}}/>)}</tr>)}</tbody>
              </table>
            </div>
          )
        }
        const line = block.lines[0]
        if (line.startsWith('### ')) return <h3 key={bi} className="font-bold text-gray-900 text-sm mt-5 mb-1 pt-2 border-t border-gray-100">{line.replace('### ','')}</h3>
        if (line.startsWith('## '))  return <h2 key={bi} className="font-bold text-gray-900 text-base mt-4 mb-1">{line.replace('## ','')}</h2>
        if (line.startsWith('# '))   return <h1 key={bi} className="font-bold text-gray-900 text-lg mt-4 mb-2">{line.replace('# ','')}</h1>
        if (line.startsWith('* ')||line.startsWith('- ')) return <div key={bi} className="flex gap-2 ml-3"><span className="text-gray-400 flex-shrink-0 mt-0.5">•</span><span dangerouslySetInnerHTML={{__html:html(line.replace(/^[*-] /,''))}}/></div>
        if (/^\d+\.\s/.test(line)) return <div key={bi} className="flex gap-2 ml-3"><span className="text-gray-500 flex-shrink-0 font-medium min-w-[1.2em]">{line.match(/^\d+/)?.[0]}.</span><span dangerouslySetInnerHTML={{__html:html(line.replace(/^\d+\.\s /,''))}}/></div>
        if (line.trim()==='') return <div key={bi} className="h-1.5"/>
        return <p key={bi} dangerouslySetInnerHTML={{__html:html(line)}}/>
      })}
    </div>
  )
}

interface AIAllocationDialogProps {
  open: boolean; order: MaterialOrder | null; products: ProductMaster[]
  plans: ProductionPlan[]; allOrders: MaterialOrder[]; lotDefs: LotDef[]
  shipmentOrders: ShipmentOrder[]; onClose: () => void
}
function AIAllocationDialog({ open, order, products, plans, allOrders, lotDefs, shipmentOrders, onClose }: AIAllocationDialogProps) {
  const [loading, setLoading] = useState(false)
  const [advice,  setAdvice]  = useState('')
  const [error,   setError]   = useState('')
  useEffect(() => { if (open && order) generateAdvice() }, [open, order])

  async function generateAdvice() {
    if (!order) return
    setLoading(true); setAdvice(''); setError('')
    try {
      const materialGroup = order.material_name, shipmentKg = order.quantity_kg
      const initEntries = allOrders.filter(o=>o.status==='initial_stock'&&o.material_name===materialGroup).sort((a,b)=>toDateStr(b.delivery_date).localeCompare(toDateStr(a.delivery_date)))
      const currentMaterialKg = initEntries[0]?.quantity_kg ?? 0
      const otherConfirmedKg  = allOrders.filter(o=>o.id!==order.id&&o.material_name===materialGroup&&(o.status==='confirmed'||o.status==='delivery_confirmed')).reduce((s,o)=>s+o.quantity_kg,0)
      const pendingKg         = allOrders.filter(o=>o.id!==order.id&&o.material_name===materialGroup&&(o.status==='pending'||o.status==='ordered')).reduce((s,o)=>s+o.quantity_kg,0)
      const totalPoolWithShipmentKg = currentMaterialKg + otherConfirmedKg + shipmentKg
      const relatedProducts = products.filter(p=>p.group_name===materialGroup&&p.weight_g)
      const totalMaterialDemandKg = relatedProducts.reduce((sum,p)=>{
        const totalPlanned = plans.filter(pl=>pl.product_code===p.product_code).reduce((s,pl)=>s+pl.planned_quantity,0)
        return sum + (p.weight_g ? (totalPlanned*p.weight_g)/1000 : 0)
      },0)
      const overallBalance = totalPoolWithShipmentKg - totalMaterialDemandKg
      const productInfoDetailed = relatedProducts.map(p=>{
        const weeklyPlan=plans.filter(pl=>pl.product_code===p.product_code)
        const totalPlanned=weeklyPlan.reduce((s,pl)=>s+pl.planned_quantity,0)
        const hyphenMatch=p.product_code.match(/-(\d{4})/)
        const shortCode=hyphenMatch?hyphenMatch[1]:p.product_code.slice(-8,-4)
        const productName=shipmentOrders.find(o=>o.product_code===p.product_code)?.product_name??''
        const finishedStock=p.initial_stock??0
        const materialNeededKg=p.weight_g?(totalPlanned*p.weight_g)/1000:0
        const demandShare=totalMaterialDemandKg>0?Math.round((materialNeededKg/totalMaterialDemandKg)*100):0
        const unitsFromShipment=p.weight_g?Math.floor((shipmentKg*1000)/p.weight_g):0
        const totalDemand=lotDefs.reduce((sum,l)=>sum+shipmentOrders.filter(o=>o.product_code===p.product_code&&o.lot_number===l.lot_id).reduce((s,o)=>s+o.quantity,0),0)
        const coverageRatio=totalDemand>0?(finishedStock+totalPlanned)/totalDemand:999
        const lotLines=lotDefs.map(l=>{
          const demand=shipmentOrders.filter(o=>o.product_code===p.product_code&&o.lot_number===l.lot_id).reduce((s,o)=>s+o.quantity,0)
          if(demand===0) return null
          const lotStart=toDateStr(l.start_from)??''
          const productionBeforeLot=weeklyPlan.filter(pl=>pl.week_start_date<lotStart).reduce((s,pl)=>s+pl.planned_quantity,0)
          const shipmentsBeforeLot=shipmentOrders.filter(o=>o.product_code===p.product_code&&toDateStr(o.delivery_date)<lotStart&&o.lot_number!==l.lot_id).reduce((s,o)=>s+o.quantity,0)
          const projectedStock=finishedStock+productionBeforeLot-shipmentsBeforeLot
          const shortage=Math.max(0,demand-projectedStock)
          const materialToFillShortage=p.weight_g?Math.ceil((shortage*p.weight_g)/1000):0
          const statusMark=shortage>0?`⚠️ 不足${shortage.toLocaleString()}個 → 解消に要${materialToFillShortage.toLocaleString()}kg`:'✅ 充足'
          return [`  【${l.lot_label}】 出荷需要: ${demand.toLocaleString()}個`,`    推定在庫: 現在庫${finishedStock.toLocaleString()} + 製造予定${productionBeforeLot.toLocaleString()} − 出荷済${shipmentsBeforeLot.toLocaleString()} = ${projectedStock.toLocaleString()}個`,`    判定: ${statusMark}`].join('\n')
        }).filter(Boolean)
        return { shortCode, productName, weightG:p.weight_g, finishedStock, totalPlanned, totalDemand, materialNeededKg, demandShare, unitsFromShipment, lotLines, coverageRatio }
      }).sort((a,b)=>a.coverageRatio-b.coverageRatio)

      const prompt = `あなたは日本の製造現場を熟知した生産管理の専門家です。
## 今回の入荷情報
- 原料グレード: ${materialGroup} / 今回の入荷数量: ${shipmentKg.toLocaleString()} kg
- 現在の材料在庫: ${currentMaterialKg.toLocaleString()} kg / 他確定: ${otherConfirmedKg.toLocaleString()} kg / 発注中: ${pendingKg.toLocaleString()} kg
- 今回入荷後合計: ${totalPoolWithShipmentKg.toLocaleString()} kg
## 全体需給バランス
全製品製造必要材料: ${Math.round(totalMaterialDemandKg).toLocaleString()} kg / 過不足: ${overallBalance>=0?'+'+Math.round(overallBalance).toLocaleString()+'kg（余剰）':'−'+Math.round(Math.abs(overallBalance)).toLocaleString()+'kg（不足）'}
## 製品別詳細（リスク高い順）
${productInfoDetailed.map((p,idx)=>`### ${idx+1}位: 【${p.shortCode}${p.productName?' '+p.productName:''}】(${p.weightG}g/個)\n- 現在庫: ${p.finishedStock.toLocaleString()}個 / 計画製造: ${p.totalPlanned.toLocaleString()}個 / 受注: ${p.totalDemand.toLocaleString()}個\n- カバレッジ: ${p.coverageRatio>=999?'受注なし':Math.round(p.coverageRatio*100)+'%'}\nLOT別:\n${p.lotLines.length>0?p.lotLines.join('\n'):'  （受注なし）'}`).join('\n\n')}
## 回答形式
### 1. 全体状況サマリ（3行以内）
### 2. 今回の入荷${shipmentKg.toLocaleString()}kgの配分提案
| 製品 | 推奨配分(kg) | 追加生産可能数 | 優先理由 |
### 3. 次のアクション（具体的に）`

      const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY
      if (!apiKey) throw new Error('NEXT_PUBLIC_GEMINI_API_KEY が設定されていません')
      const models = ['gemini-2.0-flash','gemini-1.5-flash','gemini-1.5-flash-8b']
      let aiText = ''
      for (const model of models) {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,{
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ contents:[{parts:[{text:prompt}]}], generationConfig:{maxOutputTokens:4000,temperature:0.3} })
        })
        if (!res.ok) continue
        const d = await res.json()
        aiText = d.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
        if (aiText) break
      }
      if (!aiText) throw new Error('AIのリクエスト上限に達しました。少し待ってから再分析してください。')
      setAdvice(aiText)
    } catch (e: any) { setError('AI分析に失敗しました: ' + (e?.message ?? ''))
    } finally { setLoading(false) }
  }

  if (!open || !order) return null
  const s = STATUS_CONFIG[order.status]
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl mx-4 overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b border-gray-100 flex items-start justify-between">
          <div><h3 className="text-base font-semibold text-gray-900">🤖 AI 配分アドバイス</h3><p className="text-xs text-gray-400 mt-0.5">{order.material_name} — {order.quantity_kg.toLocaleString()} kg{order.trading_company&&` — ${order.trading_company}`}</p></div>
          <span className={`text-xs font-medium px-2 py-1 rounded-full ${s.bg} ${s.color}`}>{s.label}</span>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="relative"><div className="w-12 h-12 border-3 border-blue-100 rounded-full"/><div className="w-12 h-12 border-3 border-blue-500 border-t-transparent rounded-full animate-spin absolute inset-0" style={{borderWidth:3}}/></div>
              <div className="text-center"><p className="text-sm font-medium text-gray-700">AIが在庫・需給を分析中...</p><p className="text-xs text-gray-400 mt-1">LOT別不足量・配分提案を計算しています</p></div>
              <div className="flex gap-1.5 mt-1">{[0,1,2].map(i=><div key={i} className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{animationDelay:`${i*0.15}s`}}/>)}</div>
            </div>
          ) : error ? <div className="text-sm text-red-600 bg-red-50 rounded-lg p-4">{error}</div>
            : <AdviceRenderer advice={advice}/>}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-between items-center">
          <button onClick={generateAdvice} disabled={loading} className="text-sm text-blue-600 hover:text-blue-800 disabled:opacity-40">再分析</button>
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:text-gray-800">閉じる</button>
        </div>
      </div>
    </div>
  )
}

function TradingCompanySelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const isCustom = value !== '' && !TRADING_COMPANIES.includes(value)
  return (
    <div className="space-y-2">
      <div className="flex gap-2 flex-wrap">
        {TRADING_COMPANIES.map(c => {
          const isSelected = c==='その他' ? isCustom : value===c
          const s = TRADING_COMPANY_STYLES[c]
          return <button key={c} onClick={()=>{ if(c==='その他') onChange(''); else onChange(c) }} className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${isSelected?`${s.bg} ${s.text} ${s.border}`:'border-gray-200 text-gray-500 hover:border-gray-300'}`}>{c}</button>
        })}
      </div>
      {(isCustom||value==='') && <input type="text" value={isCustom?value:''} onChange={e=>onChange(e.target.value)} placeholder="商社名を入力... (その他)" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>}
    </div>
  )
}

interface NewOrderDialogProps { open: boolean; defaultGroup?: string; defaultDate?: string; onClose: () => void; onSave: (data: Omit<MaterialOrder,'id'>) => Promise<void> }
function NewOrderDialog({ open, defaultGroup, defaultDate, onClose, onSave }: NewOrderDialogProps) {
  const [group, setGroup] = useState(defaultGroup ?? GROUP_ORDER[0])
  const [quantityKg, setQuantityKg] = useState('')
  const [deliveryDate, setDeliveryDate] = useState(defaultDate ?? '')
  const [orderDate, setOrderDate] = useState(today())
  const [status, setStatus] = useState<Status>('ordered')
  const [note, setNote] = useState('')
  const [tradingCompany, setTradingCompany] = useState('佐藤セル')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const isInitialStock = status === 'initial_stock'
  useEffect(() => { if (open) { setGroup(defaultGroup??GROUP_ORDER[0]); setDeliveryDate(defaultDate??today()); setQuantityKg(''); setOrderDate(today()); setStatus('ordered'); setNote(''); setTradingCompany('佐藤セル'); setError('') } }, [open,defaultGroup,defaultDate])
  async function handleSave() {
    if (!quantityKg||!deliveryDate) return; setSaving(true); setError('')
    try { await onSave({ material_name:group, quantity_kg:parseFloat(quantityKg), delivery_date:deliveryDate, order_date:orderDate, status, note:note.trim()||null, trading_company:isInitialStock?null:(tradingCompany.trim()||null) }); onClose() }
    catch (e: any) { setError(e?.message??'保存に失敗しました') } finally { setSaving(false) }
  }
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100"><h3 className="text-base font-semibold text-gray-900">入荷注文を追加</h3></div>
        <div className="px-6 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          <div><label className="block text-xs font-medium text-gray-600 mb-1">種別</label><div className="flex gap-2 flex-wrap">{STATUS_ORDER.map(s=>{const sc=STATUS_CONFIG[s];return <button key={s} onClick={()=>setStatus(s)} className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${status===s?`${sc.bg} ${sc.color} ${sc.border}`:'border-gray-200 text-gray-400 hover:border-gray-300'}`}>{sc.label}</button>})}</div></div>
          <div><label className="block text-xs font-medium text-gray-600 mb-1">原材料グレード</label><div className="flex gap-2 flex-wrap">{GROUP_ORDER.map(g=><button key={g} onClick={()=>setGroup(g)} className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${group===g?GROUP_STYLES[g].badge+' border-current':'border-gray-200 text-gray-500 hover:border-gray-300'}`}>{g}</button>)}</div></div>
          {!isInitialStock && <div><label className="block text-xs font-medium text-gray-600 mb-1">商社</label><TradingCompanySelector value={tradingCompany} onChange={setTradingCompany}/></div>}
          <div><label className="block text-xs font-medium text-gray-600 mb-1">{isInitialStock?'初期在庫量 (kg)':'数量 (kg)'}</label><input type="number" value={quantityKg} onChange={e=>setQuantityKg(e.target.value)} placeholder="例: 5000" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/></div>
          <div className="grid grid-cols-2 gap-3">
            {!isInitialStock && <div><label className="block text-xs font-medium text-gray-600 mb-1">発注日</label><input type="date" value={orderDate} onChange={e=>setOrderDate(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/></div>}
            <div className={isInitialStock?'col-span-2':''}><label className="block text-xs font-medium text-gray-600 mb-1">{isInitialStock?'基準日':'納入予定日'}</label><input type="date" value={deliveryDate} onChange={e=>setDeliveryDate(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/></div>
          </div>
          <div><label className="block text-xs font-medium text-gray-600 mb-1">備考（任意）</label><input type="text" value={note} onChange={e=>setNote(e.target.value)} placeholder="メモを入力..." className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/></div>
          {error && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-200 rounded-lg">キャンセル</button>
          <button onClick={handleSave} disabled={saving||!quantityKg||!deliveryDate} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 rounded-lg transition-colors">{saving?'保存中...':'保存'}</button>
        </div>
      </div>
    </div>
  )
}

interface EditOrderDialogProps { order: MaterialOrder|null; onClose: ()=>void; onStatusChange:(id:string,status:Status)=>Promise<void>; onDeliveryDateChange:(id:string,date:string)=>Promise<void>; onTradingCompanyChange:(id:string,company:string|null)=>Promise<void>; onDelete:(id:string)=>Promise<void> }
function EditOrderDialog({ order, onClose, onStatusChange, onDeliveryDateChange, onTradingCompanyChange, onDelete }: EditOrderDialogProps) {
  const [newDate, setNewDate] = useState('')
  const [tradingCompany, setTradingCompany] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  useEffect(() => { if (order) { setNewDate(toDateStr(order.delivery_date)); setTradingCompany(order.trading_company??'') } }, [order])
  if (!order) return null
  const currentDateKey = toDateStr(order.delivery_date)
  async function handleStatus(s: Status) { setSaving(true); await onStatusChange(order!.id,s); setSaving(false); onClose() }
  async function handleDateSave() { if (!newDate||newDate===currentDateKey) { onClose(); return } setSaving(true); await onDeliveryDateChange(order!.id,newDate); setSaving(false); onClose() }
  async function handleTradingCompanySave() { setSaving(true); await onTradingCompanyChange(order!.id,tradingCompany.trim()||null); setSaving(false); onClose() }
  async function handleDelete() { if (!confirm('この注文を削除しますか？')) return; setDeleting(true); await onDelete(order!.id); setDeleting(false); onClose() }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100"><div className="flex items-center justify-between"><div><h3 className="text-base font-semibold text-gray-900">入荷注文を編集</h3><p className="text-xs text-gray-400 mt-0.5">{order.material_name} — {order.quantity_kg.toLocaleString()} kg — {formatDateFull(currentDateKey)}</p></div><StatusBadge status={order.status}/></div></div>
        <div className="px-6 py-4 space-y-5 max-h-[60vh] overflow-y-auto">
          <div><p className="text-xs font-medium text-gray-600 mb-2">ステータスを変更</p><div className="grid grid-cols-1 gap-1.5">{STATUS_ORDER.map(s=>{const sc=STATUS_CONFIG[s];const active=order.status===s;return <button key={s} onClick={()=>handleStatus(s)} disabled={saving||active} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border text-sm transition-all ${active?`${sc.bg} ${sc.border} ${sc.color} font-medium cursor-default`:'border-gray-100 text-gray-600 hover:bg-gray-50'}`}><span className={`w-2 h-2 rounded-full flex-shrink-0 ${sc.dot}`}/>{sc.label}{active&&<span className="ml-auto text-xs opacity-60">現在</span>}</button>})}</div></div>
          {order.status!=='initial_stock' && <div><p className="text-xs font-medium text-gray-600 mb-2">商社を変更</p><TradingCompanySelector value={tradingCompany} onChange={setTradingCompany}/><button onClick={handleTradingCompanySave} disabled={saving} className="mt-2 w-full px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 rounded-lg transition-colors">商社を更新</button></div>}
          <div><p className="text-xs font-medium text-gray-600 mb-2">{order.status==='initial_stock'?'基準日を変更':'納入予定日を変更'}</p><div className="flex gap-2"><input type="date" value={newDate} onChange={e=>setNewDate(e.target.value)} className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/><button onClick={handleDateSave} disabled={saving||newDate===currentDateKey} className="px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 rounded-lg">更新</button></div></div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
          <button onClick={handleDelete} disabled={deleting} className="text-xs text-red-500 hover:text-red-700 disabled:opacity-40">{deleting?'削除中...':'削除'}</button>
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:text-gray-800">閉じる</button>
        </div>
      </div>
    </div>
  )
}

function GuestGuide() {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/60 overflow-hidden">
      <button onClick={()=>setOpen(v=>!v)} className="w-full flex items-center justify-between px-4 py-3 text-left">
        <div className="flex items-center gap-2.5"><span className="text-base">💡</span><div><p className="text-sm font-semibold text-blue-800">シミュレーションモードでできること</p><p className="text-xs text-blue-600 mt-0.5">ページを再読み込みするとデータはリセットされます</p></div></div>
        <svg className={`w-4 h-4 text-blue-400 transition-transform flex-shrink-0 ${open?'rotate-180':''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/></svg>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-blue-200/60 pt-3">
          <p className="text-xs text-blue-700 leading-relaxed">このページでは実際のデータベースを変更せずに、原材料の入荷状況をシミュレーションできます。</p>
          <div className="grid grid-cols-1 gap-2 text-xs">
            {[{icon:'✓',col:'text-green-500',title:'入荷ステータスを変更する',desc:'「保留中」→「確認済」→「納入確定」に変更すると、在庫フローや在庫カバレッジが即座に反映されます。'},{icon:'✓',col:'text-green-500',title:'新しい入荷注文を追加する',desc:'「＋ 入荷注文を追加」から仮の発注を追加し、在庫への影響を確認できます。'},{icon:'✓',col:'text-green-500',title:'在庫不足の影響を確認する',desc:'ステータスを変更後、サイドバーの「在庫を再計算」をクリックすると、ダッシュボードの在庫カバレッジ色が更新されます。'},{icon:'⚠',col:'text-orange-400',title:'注意: ページ再読み込みでリセット',desc:'変更はこのブラウザ画面にのみ保存されます。ページを再読み込みすると元のデータに戻ります。'}].map(({icon,col,title,desc})=>(
              <div key={title} className="flex items-start gap-2 bg-white/70 rounded-lg px-3 py-2"><span className={`${col} font-bold mt-0.5`}>{icon}</span><div><p className="font-medium text-gray-700">{title}</p><p className="text-gray-500 mt-0.5">{desc}</p></div></div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function MaterialPage() {
  const [orders,    setOrders]    = useState<MaterialOrder[]>([])
  const [products,  setProducts]  = useState<ProductMaster[]>([])
  const [plans,     setPlans]     = useState<ProductionPlan[]>([])
  const [lotDefs,   setLotDefs]   = useState<LotDef[]>([])
  const [shipments, setShipments] = useState<ShipmentOrder[]>([])
  const [loading,   setLoading]   = useState(true)
  const [newDialog, setNewDialog] = useState<{open:boolean;group?:string;date?:string}>({open:false})
  const [editOrder, setEditOrder] = useState<MaterialOrder|null>(null)
  const [aiOrder,   setAiOrder]   = useState<MaterialOrder|null>(null)

  async function fetchData() {
    setLoading(true)
    try {
      const [oRes,pRes,plRes,lRes,sRes] = await Promise.all([
        fetch('/api/material-orders').then(r => r.json()),
        fetch('/api/products').then(r => r.json()),
        fetch('/api/production-plan').then(r => r.json()),
        fetch('/api/lots').then(r => r.json()),
        fetch('/api/orders?status=active').then(r => r.json()),
      ])
      setOrders(oRes.data ?? [])
      setProducts(pRes.data ?? [])
      setPlans(plRes.data ?? [])
      setLotDefs(lRes.data ?? [])
      setShipments(sRes.data ?? [])
    } catch(e){console.error(e)} finally{setLoading(false)}
  }

  async function fetchDataForGuest() {
    setLoading(true)
    try {
      const [pRes,plRes,lRes,sRes] = await Promise.all([
        fetch('/api/products').then(r => r.json()),
        fetch('/api/production-plan').then(r => r.json()),
        fetch('/api/lots').then(r => r.json()),
        fetch('/api/orders?status=active').then(r => r.json()),
      ])
      setProducts(pRes.data ?? [])
      setPlans(plRes.data ?? [])
      setLotDefs(lRes.data ?? [])
      setShipments(sRes.data ?? [])
    } catch(e){console.error(e)} finally{setLoading(false)}
  }

  const { isGuest, isEditor } = useAuth()
  const isSimulation = isGuest || isEditor
  const { guestOrders, recalcWithOrders, clearGuestOrders } = useStock()

  useEffect(() => {
    if (isSimulation && guestOrders!==null) { setOrders(guestOrders as any[]); fetchDataForGuest(); return }
    fetchData()
  }, [])
  useEffect(() => { if (isSimulation && guestOrders!==null) setOrders(guestOrders as any[]) }, [isGuest,isEditor,guestOrders])

  async function recalcGuestStock(localOrders: typeof orders) {
    if (!isSimulation) return; await recalcWithOrders(localOrders as any[])
  }

  async function handleCreate(data: Omit<MaterialOrder,'id'>) {
    if (isSimulation) { const t:MaterialOrder={...data,id:`guest_${Date.now()}`}; setOrders(prev=>{const n=[...prev,t];recalcGuestStock(n);return n}); return }
    await fetch('/api/material-orders', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) })
    await fetchData()
  }
  async function handleStatusChange(id:string,status:Status) {
    if (isSimulation) { setOrders(prev=>{const n=prev.map(o=>o.id===id?{...o,status}:o);recalcGuestStock(n);return n}); return }
    await fetch('/api/material-orders', { method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ id, status }) }); await fetchData()
  }
  async function handleDeliveryDateChange(id:string,delivery_date:string) {
    if (isSimulation) { setOrders(prev=>{const n=prev.map(o=>o.id===id?{...o,delivery_date}:o);recalcGuestStock(n);return n}); return }
    await fetch('/api/material-orders', { method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ id, delivery_date }) }); await fetchData()
  }
  async function handleTradingCompanyChange(id:string,trading_company:string|null) {
    if (isSimulation) { setOrders(prev=>{const n=prev.map(o=>o.id===id?{...o,trading_company}:o);recalcGuestStock(n);return n}); return }
    await fetch('/api/material-orders', { method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ id, trading_company }) }); await fetchData()
  }
  async function handleDelete(id:string) {
    if (isSimulation) { setOrders(prev=>{const n=prev.filter(o=>o.id!==id);recalcGuestStock(n);return n}); return }
    await fetch('/api/material-orders', { method: 'DELETE', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ id }) }); await fetchData()
  }

  // ── FAX generation ────────────────────────────────────────────────────────
  async function generateFax(tradingCompany: string) {
    const nowDate  = new Date()
    const todayFmt = `${nowDate.getFullYear()}年${nowDate.getMonth()+1}月${nowDate.getDate()}日`
    const dateStamp = nowDate.toISOString().slice(0,10)

    const STATUS_LABELS: Record<string,string> = {
      pending:'保留中', ordered:'発注済・確認待', confirmed:'確認済',
      delivery_confirmed:'納入確定', delayed:'遅延',
    }
    function fmtDate(d:string):string {
      if(!d) return ''; const [y,m,dd]=d.slice(0,10).split('-'); return `${y}/${m}/${dd}`
    }

    // Trading company recipient info
    const FAX_RECIPIENTS: Record<string, { name: string; contact: string }> = {
      '佐藤セル':    { name: '佐藤セルロイド商店',   contact: '小板橋　様' },
      '大成':        { name: '大成産業株式会社',       contact: '安田　様' },
      '三井物産プラ': { name: '三井物産プラスチック', contact: '' },
    }
    const recipientInfo   = FAX_RECIPIENTS[tradingCompany] ?? { name: tradingCompany, contact: '' }
    const recipientName   = recipientInfo.name
    const recipientContact = recipientInfo.contact

    const faxRows = orders
      .filter(o=>o.status!=='initial_stock'&&o.trading_company===tradingCompany)
      .sort((a,b)=>{
        const ga=GROUP_ORDER.indexOf(a.material_name), gb=GROUP_ORDER.indexOf(b.material_name)
        if(ga!==gb) return ga-gb
        return toDateStr(a.delivery_date).localeCompare(toDateStr(b.delivery_date))
      })

    const bdr = { style: BorderStyle.SINGLE, size: 4, color: '000000' }
    const borders = { top:bdr, bottom:bdr, left:bdr, right:bdr }
    const CONTENT = 10466

    function c(text:string, opts:{width?:number;bold?:boolean;shading?:string;align?:any;size?:number;span?:number}={}) {
      return new TableCell({
        borders,
        width: opts.width?{size:opts.width,type:WidthType.DXA}:undefined,
        shading: opts.shading?{fill:opts.shading,type:ShadingType.CLEAR}:undefined,
        verticalAlign: VerticalAlign.CENTER,
        margins: {top:60,bottom:60,left:100,right:100},
        columnSpan: opts.span??1,
        children: [new Paragraph({
          alignment: opts.align??AlignmentType.LEFT,
          children: [new TextRun({text:text??'',font:'MS Gothic',size:opts.size??20,bold:opts.bold??false})]
        })]
      })
    }

    const doc = new Document({ sections: [{ properties: { page: { size:{width:11906,height:16838}, margin:{top:720,right:720,bottom:720,left:720} } }, children: [
      // Title
      new Paragraph({ alignment:AlignmentType.CENTER, spacing:{before:0,after:160},
        children:[new TextRun({text:'F A X 送 信 状',font:'MS Gothic',size:32,bold:true})] }),

      // Header table
      new Table({ width:{size:CONTENT,type:WidthType.DXA}, columnWidths:[1200,3000,1200,3066], rows:[
        new TableRow({children:[c('送信先',{width:1200,bold:true,shading:'DDDDDD'}),c(`${recipientName}　御中`,{width:3000}),c('送信日',{width:1200,bold:true,shading:'DDDDDD'}),c(todayFmt,{width:3066})]}),
        new TableRow({children:[c('担当者様',{width:1200,bold:true,shading:'DDDDDD'}),c(recipientContact,{width:3000}),c('FAX番号',{width:1200,bold:true,shading:'DDDDDD'}),c('',{width:3066})]}),
        new TableRow({children:[c('発信者',{width:1200,bold:true,shading:'DDDDDD'}),c('衣笠・楚輪',{width:3000}),c('ページ数',{width:1200,bold:true,shading:'DDDDDD'}),c('本状含む　計1枚',{width:3066})]}),
        new TableRow({children:[c('会社名',{width:1200,bold:true,shading:'DDDDDD'}),c('株式会社平田商店',{width:3000}),c('TEL',{width:1200,bold:true,shading:'DDDDDD'}),c('048-227-5313',{width:3066})]}),
      ]}),

      new Paragraph({spacing:{before:120,after:80}}),

      // Subject
      new Paragraph({spacing:{before:80,after:80},children:[
        new TextRun({text:'件名：',font:'MS Gothic',size:20,bold:true}),
        new TextRun({text:'プラスチック原材料のご発注状況および納期確認のお願い',font:'MS Gothic',size:20}),
      ]}),
      new Paragraph({spacing:{before:80,after:80}}),

      // Body text
      ...[
        '拝啓　貴社ますますご清栄のこととお慶び申し上げます。',
        '　平素より格別のお引き立てを賜り、誠にありがとうございます。',
        '　さて、先般ご発注申し上げておりましたプラスチック原材料につきまして、現在の進捗状況および納期の最新情報をご確認させていただきたく、本状を送付申し上げる次第でございます。',
        '　誠に恐れ入りますが、昨今のホルムズ海峡における情勢不安をはじめとする諸般の事情により、弊社において原材料の在庫が逼迫している状況でございます。つきましては、下記発注リストに記載の各品目について、現時点でのご対応状況および確定納期につきまして、お手数ですがご確認・ご連絡をいただけますと幸いでございます。',
        '　特に「保留中」および「発注済・確認待」となっている案件につきましては、早急にご確認いただけますよう、重ねてお願い申し上げます。',
      ].map(t=>new Paragraph({spacing:{before:60,after:60},children:[new TextRun({text:t,font:'MS Gothic',size:18})]})),

      new Paragraph({spacing:{before:120,after:80}}),

      // Order list title
      new Paragraph({spacing:{before:80,after:80},children:[new TextRun({text:'【発注済み原材料リスト】',font:'MS Gothic',size:20,bold:true})]}),

      // Order table
      new Table({ width:{size:CONTENT,type:WidthType.DXA}, columnWidths:[1800,1600,2200,2200,2666], rows:[
        new TableRow({tableHeader:true,children:[
          c('樹脂名',{width:1800,bold:true,shading:'DDDDDD',align:AlignmentType.CENTER}),
          c('数量',{width:1600,bold:true,shading:'DDDDDD',align:AlignmentType.CENTER}),
          c('当社希望納期',{width:2200,bold:true,shading:'DDDDDD',align:AlignmentType.CENTER}),
          c('メーカー納期',{width:2200,bold:true,shading:'DDDDDD',align:AlignmentType.CENTER}),
          c('ステータス',{width:2666,bold:true,shading:'DDDDDD',align:AlignmentType.CENTER}),
        ]}),
        ...faxRows.map(mo=>new TableRow({children:[
          c(mo.material_name,{width:1800,align:AlignmentType.CENTER}),
          c(`${mo.quantity_kg.toLocaleString()} kg`,{width:1600,align:AlignmentType.RIGHT}),
          c(fmtDate(toDateStr(mo.delivery_date)),{width:2200,align:AlignmentType.CENTER}),
          c('',{width:2200,align:AlignmentType.CENTER}),
          c(STATUS_LABELS[mo.status]??mo.status,{width:2666,align:AlignmentType.CENTER}),
        ]})),
      ]}),

      new Paragraph({spacing:{before:160,after:80}}),
      new Paragraph({spacing:{before:60,after:60},children:[new TextRun({text:'ご多忙のところ誠に恐縮ではございますが、何卒よろしくお願い申し上げます。',font:'MS Gothic',size:18})]}),
      new Paragraph({spacing:{before:80,after:0}}),
      new Paragraph({alignment:AlignmentType.RIGHT,children:[new TextRun({text:'敬具',font:'MS Gothic',size:18})]}),
    ]}]})

    const buf  = await Packer.toBuffer(doc)
    const blob = new Blob([new Uint8Array(buf)],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'})
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a'); a.href=url; a.download=`FAX_${tradingCompany}_${dateStamp}.docx`; a.click()
    URL.revokeObjectURL(url)
  }

  // ── Computed values ───────────────────────────────────────────────────────
  const weightMap = useMemo(()=>{const m=new Map<string,number>();for(const p of products){if(p.weight_g)m.set(p.product_code.trim(),p.weight_g)};return m},[products])
  const groupMap  = useMemo(()=>{const m=new Map<string,string>();for(const p of products){if(p.group_name)m.set(p.product_code.trim(),p.group_name.trim())};return m},[products])

  const missingWeightCodes = useMemo(()=>{
    const allPlanCodes=new Set(plans.map(p=>p.product_code.trim()))
    return [...allPlanCodes].filter(code=>!weightMap.has(code))
  },[plans,weightMap])

  const weeklyConsumption = useMemo(()=>{
    const result=new Map<string,Map<string,number>>()
    for(const plan of plans){
      const code=plan.product_code.trim(),wg=weightMap.get(code);if(!wg) continue
      const groupName=groupMap.get(code);if(!groupName) continue
      const kgUsed=(plan.planned_quantity*wg)/1000,planWeekKey=getMondayStr(plan.week_start_date)
      if(!result.has(planWeekKey)) result.set(planWeekKey,new Map())
      const wMap=result.get(planWeekKey)!; wMap.set(groupName,(wMap.get(groupName)??0)+kgUsed)
    }
    return result
  },[plans,groupMap,weightMap])

  const {flowWeeks,stockFlow} = useMemo(()=>{
    const flowWeeks=generateWeeks('2026-04-01',52),firstWeek=flowWeeks[0]
    const CONFIRMED_STATUSES:Status[]=['delivery_confirmed','confirmed']
    const initialStock=new Map<string,number>()
    const initEntries=orders.filter(o=>o.status==='initial_stock')
    for(const g of GROUP_ORDER){const entries=initEntries.filter(o=>o.material_name===g).sort((a,b)=>toDateStr(b.delivery_date).localeCompare(toDateStr(a.delivery_date)));initialStock.set(g,entries.length>0?entries[0].quantity_kg:0)}
    const openingBalance=new Map<string,number>(GROUP_ORDER.map(g=>[g,initialStock.get(g)??0]))
    for(const o of orders){
      if(o.status==='initial_stock') continue; if(!CONFIRMED_STATUSES.includes(o.status)) continue
      const dateKey=toDateStr(o.delivery_date); if(!dateKey) continue
      const weekStart=getMondayStr(dateKey); if(weekStart<firstWeek) openingBalance.set(o.material_name,(openingBalance.get(o.material_name)??0)+o.quantity_kg)
    }
    const confirmedByWeek=new Map<string,Map<string,number>>(),pendingByWeek=new Map<string,Map<string,number>>()
    for(const o of orders){
      if(o.status==='initial_stock') continue
      const dateKey=toDateStr(o.delivery_date); if(!dateKey) continue
      const weekStart=getMondayStr(dateKey)
      if(CONFIRMED_STATUSES.includes(o.status)&&weekStart<firstWeek) continue
      const isConfirmed=CONFIRMED_STATUSES.includes(o.status),targetMap=isConfirmed?confirmedByWeek:pendingByWeek
      if(!targetMap.has(weekStart)) targetMap.set(weekStart,new Map())
      const wMap=targetMap.get(weekStart)!; wMap.set(o.material_name,(wMap.get(o.material_name)??0)+o.quantity_kg)
    }
    const stockFlow=new Map<string,{incoming:number;incomingPending:number;consumed:number;balance:number;shortfall:boolean}[]>()
    for(const g of GROUP_ORDER){
      let balance=openingBalance.get(g)??0
      const rows:{incoming:number;incomingPending:number;consumed:number;balance:number;shortfall:boolean}[]=[]
      for(const weekStart of flowWeeks){
        const incoming=confirmedByWeek.get(weekStart)?.get(g)??0
        const incomingPending=pendingByWeek.get(weekStart)?.get(g)??0
        const consumed=weeklyConsumption.get(weekStart)?.get(g)??0
        balance-=consumed; const shortfall=balance<0; balance+=incoming
        rows.push({incoming,incomingPending,consumed,balance,shortfall})
      }
      stockFlow.set(g,rows)
    }
    return {flowWeeks,stockFlow}
  },[orders,weeklyConsumption])

  const purchaseOrders = orders.filter(o=>o.status!=='initial_stock')
  const {dateCols,matrix} = useMemo(()=>{
    const dateSet=new Set<string>()
    for(const o of purchaseOrders){const key=toDateStr(o.delivery_date);if(key)dateSet.add(key)}
    const dateCols=Array.from(dateSet).sort()
    const matrix:Record<string,Record<string,MaterialOrder[]>>={}
    for(const g of GROUP_ORDER){matrix[g]={};for(const d of dateCols)matrix[g][d]=[]}
    for(const o of purchaseOrders){const key=toDateStr(o.delivery_date);if(matrix[o.material_name]?.[key]!==undefined)matrix[o.material_name][key].push(o)}
    return {dateCols,matrix}
  },[purchaseOrders])

  const tradingCompaniesWithOrders = useMemo(()=>[...new Set(purchaseOrders.map(o=>o.trading_company).filter(Boolean))] as string[],[purchaseOrders])

  function colTotal(date:string):number{return GROUP_ORDER.reduce((sum,g)=>sum+(matrix[g][date]??[]).reduce((s,o)=>s+o.quantity_kg,0),0)}
  function rowTotal(group:string):number{return dateCols.reduce((sum,d)=>sum+(matrix[group][d]??[]).reduce((s,o)=>s+o.quantity_kg,0),0)}

  return (
    <div className="h-full overflow-auto p-4 space-y-10">
      {isSimulation && <GuestGuide/>}
      {isSimulation && (
        <div className="flex items-center justify-between px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl">
          <div className="flex items-center gap-2.5"><span className="text-lg">🧪</span><div><p className="text-sm font-semibold text-amber-800">シミュレーションモード</p><p className="text-xs text-amber-600 mt-0.5">変更はこのブラウザ画面のみに反映されます。データベースには保存されません。</p></div></div>
          <button onClick={()=>{clearGuestOrders();fetchData()}} className="text-xs text-amber-700 border border-amber-300 hover:bg-amber-100 rounded-lg px-3 py-1.5 transition-colors whitespace-nowrap">🔄 元データに戻す</button>
        </div>
      )}

      {/* Stock Flow */}
      <div>
        <div className="mb-4"><h2 className="text-xl font-semibold text-gray-900">原材料在庫フロー</h2><p className="text-sm text-gray-400 mt-0.5">2026年4月〜2027年3月 週次入荷・消費・残在庫の推移</p></div>
        {missingWeightCodes.length>0 && (
          <div className="mb-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
            <span className="font-semibold">⚠️ 消費量が計算できない品番があります</span><span className="text-amber-600 ml-1">— ProductMasterに重量(weight_g)が未登録:</span>
            <div className="mt-1 font-mono text-amber-700 flex flex-wrap gap-1">{missingWeightCodes.map(c=><span key={c} className="bg-amber-100 px-1.5 py-0.5 rounded">{c}</span>)}</div>
          </div>
        )}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse" style={{minWidth:'max-content'}}>
              <thead className="sticky top-0 z-30">
                <tr className="bg-gray-800 text-white">
                  <th className="sticky left-0 z-40 bg-gray-800 border-r border-gray-600 px-4 py-2.5 text-left font-medium whitespace-nowrap min-w-[100px]">原材料</th>
                  <th className="sticky left-[100px] z-40 bg-gray-800 border-r border-gray-600 px-3 py-2.5 text-left font-medium whitespace-nowrap min-w-[70px]">項目</th>
                  {flowWeeks.map(w=><th key={w} className="px-2 py-2.5 text-center font-medium whitespace-nowrap border-l border-gray-600 min-w-[90px]">{formatWeekLabel(w)}</th>)}
                </tr>
              </thead>
              <tbody>
                {GROUP_ORDER.map((g,gIdx)=>{
                  const gs=GROUP_STYLES[g],rows=stockFlow.get(g)??[]
                  const rawInitKg=orders.filter(o=>o.status==='initial_stock'&&o.material_name===g).sort((a,b)=>toDateStr(b.delivery_date).localeCompare(toDateStr(a.delivery_date)))[0]?.quantity_kg??0
                  const firstWeekStr=flowWeeks[0]??''
                  const preChartConfirmed=orders.filter(o=>o.material_name===g&&(o.status==='confirmed'||o.status==='delivery_confirmed')&&getMondayStr(toDateStr(o.delivery_date))<firstWeekStr).reduce((s,o)=>s+o.quantity_kg,0)
                  const initKg=rawInitKg+preChartConfirmed
                  return (
                    <>
                      <tr key={`${g}-in`} className={`border-b border-gray-100 ${gIdx%2===0?'bg-white':'bg-gray-50/40'}`}>
                        <td className="sticky left-0 z-10 bg-white border-r border-gray-100 px-4 py-2 whitespace-nowrap" rowSpan={3} style={{boxShadow:'2px 0 6px -2px rgba(0,0,0,0.10)'}}>
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${gs.badge}`}>{g}</span>
                          <div className="text-[10px] text-gray-400 mt-1">初期: {initKg.toLocaleString()} kg</div>
                        </td>
                        <td className="sticky left-[100px] z-10 bg-white border-r border-gray-200 px-3 py-2 text-sky-600 font-medium whitespace-nowrap" style={{boxShadow:'4px 0 10px -2px rgba(0,0,0,0.10)'}}>入荷 +</td>
                        {rows.map((r,i)=>(
                          <td key={i} className="border-l border-gray-100 px-2 py-2 text-right tabular-nums">
                            {r.incoming>0&&<span className="text-sky-700 font-medium">+{r.incoming.toLocaleString()}</span>}
                            {r.incomingPending>0&&<span className={`text-sky-500 ${r.incoming>0?'block':''}`} style={{opacity:0.5}} title="未確定 (在庫計算に含まず)">(+{r.incomingPending.toLocaleString()})</span>}
                            {r.incoming===0&&r.incomingPending===0&&<span className="text-gray-200">—</span>}
                          </td>
                        ))}
                      </tr>
                      <tr key={`${g}-out`} className={`border-b border-gray-100 ${gIdx%2===0?'bg-white':'bg-gray-50/40'}`}>
                        <td className="sticky left-[100px] z-10 bg-white border-r border-gray-200 px-3 py-2 text-orange-600 font-medium whitespace-nowrap" style={{boxShadow:'4px 0 10px -2px rgba(0,0,0,0.10)'}}>消費 −</td>
                        {rows.map((r,i)=><td key={i} className="border-l border-gray-100 px-2 py-2 text-right tabular-nums text-orange-700">{r.consumed>0?`−${Math.round(r.consumed).toLocaleString()}`:<span className="text-gray-200">—</span>}</td>)}
                      </tr>
                      <tr key={`${g}-bal`} className={`border-b-2 border-gray-200 ${gIdx%2===0?'bg-white':'bg-gray-50/40'}`}>
                        <td className="sticky left-[100px] z-10 bg-white border-r border-gray-200 px-3 py-2 font-bold text-gray-700 whitespace-nowrap" style={{boxShadow:'4px 0 10px -2px rgba(0,0,0,0.10)'}}>残在庫</td>
                        {rows.map((r,i)=>{
                          const style=r.shortfall?{bg:'bg-red-100',text:'text-red-800'}:balanceStyle(r.balance)
                          return <td key={i} className={`border-l border-gray-100 px-2 py-2 text-right tabular-nums font-semibold ${style.bg} ${style.text}`} title={r.shortfall?'⚠️ 週初時点で材料不足':''}>{r.shortfall&&<span className="mr-1">⚠️</span>}{Math.round(r.balance).toLocaleString()} kg</td>
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
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-100 border border-red-200 inline-block"/>不足 ⚠️ 生産縮小が必要</span>
          <span className="text-gray-300">|</span>
          <span className="text-sky-600 font-medium">+1,000</span><span>= 納入確定・確認済（在庫計算に含む）</span>
          <span className="text-sky-400 opacity-50 font-medium">(+1,000)</span><span>= 発注中・未確定（参考値、計算に含まず）</span>
        </div>
      </div>

      {/* Purchase Order Schedule */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div><h2 className="text-xl font-semibold text-gray-900">原材料入荷スケジュール</h2><p className="text-sm text-gray-400 mt-0.5">{purchaseOrders.length} 件 — セルをクリックでステータス変更</p></div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <button onClick={fetchData} className="text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5">更新</button>
            {!isGuest && !isEditor && tradingCompaniesWithOrders.map(tc=>(
              <button key={tc} onClick={()=>generateFax(tc)} className="text-sm font-medium text-white bg-orange-500 hover:bg-orange-600 rounded-lg px-4 py-1.5 transition-colors">
                📠 FAX ({tc})
              </button>
            ))}
            <button onClick={()=>setNewDialog({open:true})} className="text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg px-4 py-1.5 transition-colors">＋ 入荷注文を追加</button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mb-4">
          {PURCHASE_STATUSES.map(s=>{const sc=STATUS_CONFIG[s];return <span key={s} className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${sc.bg} ${sc.color} ${sc.border}`}><span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`}/>{sc.label}</span>})}
        </div>
        {loading ? <div className="text-center py-20 text-sm text-gray-400">読み込み中...</div> : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="text-xs border-collapse" style={{minWidth:'max-content'}}>
                <thead className="sticky top-0 z-30">
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="sticky left-0 z-40 bg-gray-50 border-r border-gray-200 px-4 py-3 text-left font-medium text-gray-500 whitespace-nowrap min-w-[120px]">原材料グレード</th>
                    {dateCols.map(d=><th key={d} className="px-3 py-3 text-center font-medium text-gray-500 whitespace-nowrap border-l border-gray-100 min-w-[130px]" title={formatDateFull(d)}><div>{formatDate(d)}</div><div className="text-[10px] text-gray-400 font-normal">{formatDateFull(d)}</div></th>)}
                    <th className="px-3 py-3 text-right font-medium text-gray-500 whitespace-nowrap border-l border-gray-200 min-w-[80px]">合計</th>
                    <th className="px-3 py-3 border-l border-gray-200 min-w-[50px]"/>
                  </tr>
                </thead>
                <tbody>
                  {GROUP_ORDER.map(group=>{
                    const style=GROUP_STYLES[group],rTotal=rowTotal(group)
                    return (
                      <tr key={group} className={`border-b border-gray-100 ${style.rowBg}`}>
                        <td className="sticky left-0 z-10 bg-white border-r border-gray-200 px-4 py-3 whitespace-nowrap" style={{boxShadow:'4px 0 10px -2px rgba(0,0,0,0.08)'}}>
                          <span className={`text-xs font-semibold px-2 py-1 rounded-full ${style.badge}`}>{group}</span>
                        </td>
                        {dateCols.map(d=>{
                          const cellOrders=matrix[group][d]??[]
                          return (
                            <td key={d} className="border-l border-gray-100 px-2 py-2 align-top min-w-[130px]">
                              {cellOrders.length>0 ? <div>{cellOrders.map(o=><OrderCell key={o.id} order={o} onClick={()=>setEditOrder(o)} onAllocate={()=>setAiOrder(o)}/>)}</div>
                                : <button onClick={()=>setNewDialog({open:true,group,date:d})} className="w-full h-10 rounded-lg border border-dashed border-gray-200 text-gray-300 hover:border-blue-300 hover:text-blue-400 transition-colors text-lg">+</button>}
                            </td>
                          )
                        })}
                        <td className="border-l border-gray-200 px-3 py-3 text-right font-semibold text-gray-700 whitespace-nowrap tabular-nums">{rTotal>0?`${rTotal.toLocaleString()} kg`:'—'}</td>
                        <td className="border-l border-gray-200 px-2 py-3 text-center"><button onClick={()=>setNewDialog({open:true,group})} className="text-gray-300 hover:text-blue-500 transition-colors text-lg leading-none">+</button></td>
                      </tr>
                    )
                  })}
                  <tr className="bg-gray-50 border-t-2 border-gray-300">
                    <td className="sticky left-0 z-10 bg-gray-50 border-r border-gray-200 px-4 py-2.5 font-semibold text-gray-600 text-xs whitespace-nowrap" style={{boxShadow:'4px 0 10px -2px rgba(0,0,0,0.08)'}}>日別合計</td>
                    {dateCols.map(d=>{const total=colTotal(d);return <td key={d} className="border-l border-gray-200 px-3 py-2.5 text-right font-semibold text-gray-700 tabular-nums whitespace-nowrap">{total>0?`${total.toLocaleString()} kg`:'—'}</td>})}
                    <td className="border-l border-gray-300 px-3 py-2.5 text-right font-bold text-gray-900 tabular-nums whitespace-nowrap">{GROUP_ORDER.reduce((sum,g)=>sum+rowTotal(g),0).toLocaleString()} kg</td>
                    <td className="border-l border-gray-200"/>
                  </tr>
                </tbody>
              </table>
            </div>
            {purchaseOrders.length===0 && (
              <div className="text-center py-16"><p className="text-sm text-gray-400 mb-3">まだ入荷注文がありません</p><button onClick={()=>setNewDialog({open:true})} className="text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg px-4 py-2">＋ 最初の入荷注文を追加</button></div>
            )}
          </div>
        )}
      </div>

      <NewOrderDialog open={newDialog.open} defaultGroup={newDialog.group} defaultDate={newDialog.date} onClose={()=>setNewDialog({open:false})} onSave={handleCreate}/>
      <EditOrderDialog order={editOrder} onClose={()=>setEditOrder(null)} onStatusChange={handleStatusChange} onDeliveryDateChange={handleDeliveryDateChange} onTradingCompanyChange={handleTradingCompanyChange} onDelete={handleDelete}/>
      <AIAllocationDialog open={aiOrder!==null} order={aiOrder} products={products} plans={plans} allOrders={orders} lotDefs={lotDefs} shipmentOrders={shipments} onClose={()=>setAiOrder(null)}/>
    </div>
  )
}