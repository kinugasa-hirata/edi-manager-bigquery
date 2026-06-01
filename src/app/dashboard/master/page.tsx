'use client'

import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'

const GROUP_NAMES: Record<string, string> = { A: 'M90S', B: '300NP', C: '100G20', D: '950X01' }
const LOT_LABELS: Record<string, string> = {
  '1': '4／初〜', '2': '4／末〜', '3': '5／末〜', '4': '6／中〜',
  '5': '7／末〜', '6': '9／初〜', '7': '10／初〜', '8': '11／初〜',
  '9': '11／中〜', '10': '12／中〜', '国①': '1／中〜', '国②': '2／初〜',
}
const LOT_ORDER   = ['1','2','3','4','5','6','7','8','9','10','国①','国②']
const GROUP_ORDER = ['M90S', '300NP', '100G20', '950X01']
const GROUP_COLORS: Record<string, string> = {
  'M90S': 'bg-blue-50 text-blue-700', '300NP': 'bg-green-50 text-green-700',
  '100G20': 'bg-red-50 text-red-700', '950X01': 'bg-purple-50 text-purple-700',
}

interface Product {
  id: string; product_code: string; group_name: string; weight_g: number | null; sort_order: number
}
interface Lot {
  id: string; lot_id: string; lot_label: string; start_from: string; end_at: string; sort_order: number
}

export default function MasterPage() {
  const [products,   setProducts]   = useState<Product[]>([])
  const [lots,       setLots]       = useState<Lot[]>([])
  const [loading,    setLoading]    = useState(true)
  const [uploading,  setUploading]  = useState(false)
  const [log,        setLog]        = useState<string[]>([])
  const [uploadDone, setUploadDone] = useState(false)

  async function fetchData() {
    setLoading(true)
    try {
      const [pRes, lRes] = await Promise.all([
        fetch('/api/products').then(r => r.json()),
        fetch('/api/lots').then(r => r.json()),
      ])
      setProducts(pRes.data ?? [])
      setLots(lRes.data ?? [])
    } finally { setLoading(false) }
  }

  useEffect(() => { fetchData() }, [])

  function addLog(msg: string) { setLog(prev => [...prev, msg]) }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    setUploading(true); setLog([]); setUploadDone(false)
    try {
      const buffer = await file.arrayBuffer()
      const wb   = XLSX.read(buffer, { type: 'array', cellDates: true })
      const raw1 = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[wb.SheetNames[0]], { header: 1 })
      const raw2 = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[wb.SheetNames[1]], { header: 1 })
      const raw3 = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[wb.SheetNames[2]], { header: 1 })

      // Sheet1: Product master
      addLog('商品マスタを登録中...')
      const groupKeys  = ['A', 'B', 'C', 'D']
      const productRows: any[] = []
      for (let colIdx = 0; colIdx < 4; colIdx++) {
        const key   = groupKeys[colIdx]
        const gname = GROUP_NAMES[key]
        const codes = raw1.map((row: any) => row[colIdx]?.toString().trim()).filter(Boolean)
        for (let i = 0; i < codes.length; i++) {
          productRows.push({ product_code: codes[i], group_name: gname, sort_order: colIdx * 100 + i })
        }
        addLog(`  [${key}] ${gname}: ${codes.length} 品番`)
      }
      const pRes = await fetch('/api/master', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'upsert_products', rows: productRows }),
      })
      const pData = await pRes.json()
      addLog(`  登録完了: ${pData.count} 件`)

      // Sheet3: Weight data
      addLog('重量データを更新中...')
      const weightRows = raw3.slice(1)
        .map((row: any) => ({ product_code: row[0]?.toString().trim(), weight_g: parseFloat(row[1]) }))
        .filter(r => r.product_code && !isNaN(r.weight_g))
      const wRes = await fetch('/api/master', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_weights', rows: weightRows }),
      })
      const wData = await wRes.json()
      addLog(`  重量更新: ${wData.count} 件`)

      // Sheet2: LOT definitions
      addLog('LOT定義を登録中...')
      const lotRows: any[] = []
      for (let i = 1; i < raw2.length; i++) {
        const row   = raw2[i]
        const lotId = row[0]?.toString().trim()
        if (!lotId || !row[1] || !row[2]) continue
        const start = row[1] instanceof Date ? row[1] : new Date(row[1])
        const end   = row[2] instanceof Date ? row[2] : new Date(row[2])
        lotRows.push({ lot_id: lotId, lot_label: LOT_LABELS[lotId] ?? lotId, start_from: start.toISOString(), end_at: end.toISOString(), sort_order: i })
        addLog(`  LOT ${lotId}: ${start.toLocaleDateString('ja')} 〜 ${end.toLocaleDateString('ja')}`)
      }
      await fetch('/api/master', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'upsert_lots', rows: lotRows }),
      })

      addLog('✅ 完了')
      setUploadDone(true)
      await fetchData()
    } catch (err: any) {
      addLog(`❌ エラー: ${err.message}`)
    } finally { setUploading(false); e.target.value = '' }
  }

  return (
    <div className="h-full overflow-auto p-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">マスタ管理</h2>
          <p className="text-sm text-gray-400 mt-0.5">品番グループ・LOT定義・重量データの管理</p>
        </div>
        <label className="cursor-pointer px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors">
          {uploading ? '登録中...' : 'edi_filtering.xlsx を更新'}
          <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} disabled={uploading} />
        </label>
      </div>

      {log.length > 0 && (
        <div className="bg-gray-900 rounded-xl p-4 mb-6 font-mono text-xs text-green-400 space-y-0.5 max-h-40 overflow-auto">
          {log.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-gray-400 py-8 text-center">読み込み中...</div>
      ) : (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-700">品番マスタ</h3>
              <span className="text-xs text-gray-400">{products.length} 品番</span>
            </div>
            <div className="divide-y divide-gray-50">
              {GROUP_ORDER.map(gname => {
                const gProducts = products.filter(p => p.group_name === gname).sort((a, b) => a.sort_order - b.sort_order)
                if (gProducts.length === 0) return null
                return (
                  <div key={gname} className="px-5 py-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${GROUP_COLORS[gname] ?? 'bg-gray-100 text-gray-600'}`}>{gname}</span>
                      <span className="text-xs text-gray-400">{gProducts.length} 品番</span>
                    </div>
                    <table className="w-full text-xs">
                      <thead><tr className="text-gray-400"><th className="text-left py-1 pr-6 font-medium">品番コード</th><th className="text-right py-1 font-medium">重量(g)</th></tr></thead>
                      <tbody className="divide-y divide-gray-50">
                        {gProducts.map(p => (
                          <tr key={p.id ?? p.product_code}>
                            <td className="py-1 pr-6 font-mono text-gray-600">{p.product_code}</td>
                            <td className="py-1 text-right text-gray-500">{p.weight_g ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-700">LOT定義</h3>
              <span className="text-xs text-gray-400">{lots.length} LOT</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="text-left px-5 py-2.5 font-medium text-gray-500 text-xs">LOT</th>
                    <th className="text-left px-5 py-2.5 font-medium text-gray-500 text-xs">表示名</th>
                    <th className="text-left px-5 py-2.5 font-medium text-gray-500 text-xs">開始日</th>
                    <th className="text-left px-5 py-2.5 font-medium text-gray-500 text-xs">終了日</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {LOT_ORDER.map(lotId => {
                    const lot = lots.find(l => l.lot_id === lotId); if (!lot) return null
                    return (
                      <tr key={lotId} className="hover:bg-gray-50">
                        <td className="px-5 py-2 font-medium text-gray-700">{lotId}</td>
                        <td className="px-5 py-2 text-gray-600">{lot.lot_label}</td>
                        <td className="px-5 py-2 text-gray-500">{new Date(lot.start_from).toLocaleDateString('ja-JP')}</td>
                        <td className="px-5 py-2 text-gray-500">{new Date(lot.end_at).toLocaleDateString('ja-JP')}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}