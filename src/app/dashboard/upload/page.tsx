'use client'

import { useState, useCallback } from 'react'
import { useAuth } from '@/lib/auth-context'
import { parseEdiFile } from '@/lib/edi-parser'
import {
  fetchProductMaster, fetchLotDefinitions,
  processNormalEdi, processCancelEdi, processHenkouEdi,
  writeUploadLog
} from '@/lib/edi-operations'

type Status = 'idle' | 'parsing' | 'processing' | 'done' | 'error'

interface Result {
  filename: string
  fileType: string
  total: number
  inserted: number
  updated: number
  cancelled: number
  skipped: number
}

// Ensure correct processing order: normal → henkou → torikeshi
const FILE_TYPE_ORDER: Record<string, number> = {
  normal:    0,
  henkou:    1,
  torikeshi: 2,
}

export default function UploadPage() {
  const { user } = useAuth()
  const [status, setStatus]           = useState<Status>('idle')
  const [progress, setProgress]       = useState(0)
  const [progressMax, setProgressMax] = useState(0)
  const [currentFile, setCurrentFile] = useState('')
  const [results, setResults]         = useState<Result[]>([])
  const [error, setError]             = useState('')
  const [dragging, setDragging]       = useState(false)

  async function processFiles(files: FileList | File[]) {
    const fileArray = Array.from(files).filter(f =>
      f.name.toLowerCase().endsWith('.edidat') ||
      f.name.toLowerCase().endsWith('.dat')
    )
    if (fileArray.length === 0) {
      setError('EDIdat ファイルを選択してください (.edidat または .dat)')
      return
    }

    setStatus('parsing')
    setError('')
    setResults([])

    try {
      // Pre-parse all files to detect their type first
      const parsed: {
        file: File
        rows: Awaited<ReturnType<typeof parseEdiFile>>['rows']
        fileType: string
        issueDate: string
      }[] = []

      for (const file of fileArray) {
        const { rows, fileType, issueDate } = await parseEdiFile(file)
        parsed.push({ file, rows, fileType, issueDate })
      }

      // Sort: normal(0) → henkou(1) → torikeshi(2)
      parsed.sort((a, b) =>
        (FILE_TYPE_ORDER[a.fileType] ?? 9) - (FILE_TYPE_ORDER[b.fileType] ?? 9)
      )

      setStatus('processing')
      const products = await fetchProductMaster()
      const lots     = await fetchLotDefinitions()

      if (products.length === 0) {
        setError('商品マスタが登録されていません。先にマスタ管理からデータを登録してください。')
        setStatus('error')
        return
      }

      const allResults: Result[] = []

      for (const { file, rows, fileType } of parsed) {
        setCurrentFile(file.name)
        setProgressMax(rows.length)
        setProgress(0)

        const onProgress = (n: number) => setProgress(n)
        let inserted = 0, updated = 0, cancelled = 0, skipped = 0

        if (fileType === 'torikeshi') {
          const r = await processCancelEdi(rows, onProgress)
          cancelled = r.cancelled
          skipped   = r.notFound
        } else if (fileType === 'henkou') {
          const r = await processHenkouEdi(rows, products, lots, file.name, onProgress)
          inserted = r.inserted
          updated  = r.updated
          skipped  = r.skipped
        } else {
          const r = await processNormalEdi(rows, products, lots, file.name, onProgress)
          inserted = r.inserted
          updated  = r.updated
          skipped  = r.skipped
        }

        // ── Write upload log (no issue_date — not in DB schema) ──────────────
        await writeUploadLog({
          filename:       file.name,
          file_type:      fileType,
          rows_total:     rows.length,
          rows_inserted:  inserted,
          rows_updated:   updated,
          rows_cancelled: cancelled,
          rows_skipped:   skipped,
          uploaded_by:    user?.email ?? '',
          status:         'success',
        })

        allResults.push({
          filename: file.name,
          fileType,
          total:     rows.length,
          inserted,
          updated,
          cancelled,
          skipped,
        })
      }

      setResults(allResults)
      setStatus('done')
    } catch (e: any) {
      setError(e.message ?? '処理中にエラーが発生しました')
      setStatus('error')
    } finally {
      setCurrentFile('')
    }
  }

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) processFiles(e.target.files)
    e.target.value = ''
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer.files) processFiles(e.dataTransfer.files)
  }, [])

  const fileTypeLabel: Record<string, string> = {
    normal:    '通常 (0502)',
    henkou:    '変更 (0503)',
    torikeshi: '取消 (0504)',
  }

  const fileTypeBadge: Record<string, string> = {
    normal:    'bg-blue-50 text-blue-700',
    henkou:    'bg-amber-50 text-amber-700',
    torikeshi: 'bg-red-50 text-red-700',
  }

  const fileTypeOrder: Record<string, string> = {
    normal:    '① ',
    henkou:    '② ',
    torikeshi: '③ ',
  }

  return (
    <div className="h-full overflow-auto p-8 max-w-3xl">
      <h2 className="text-xl font-semibold text-gray-900 mb-1">EDI アップロード</h2>
      <p className="text-sm text-gray-500 mb-1">EDIdat ファイルをアップロードして処理します。複数ファイル同時対応。</p>
      <p className="text-xs text-gray-400 mb-6">
        複数ファイルを同時選択した場合、自動的に <span className="font-medium text-gray-500">通常 → 変更 → 取消</span> の順で処理されます。
      </p>

      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`rounded-xl border-2 border-dashed p-12 text-center transition-colors mb-6 ${
          dragging ? 'border-blue-400 bg-blue-50' : 'border-gray-300 bg-white'
        }`}
      >
        <p className="text-gray-500 text-sm mb-3">ここにファイルをドロップ</p>
        <p className="text-gray-400 text-xs mb-4">または</p>
        <label className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
          ファイルを選択（複数可）
          <input
            type="file"
            accept=".edidat,.dat"
            multiple
            className="hidden"
            onChange={onFileChange}
            disabled={status === 'processing'}
          />
        </label>
        <p className="text-gray-400 text-xs mt-3">.edidat / .dat ファイル対応</p>
      </div>

      {/* Processing order guide */}
      <div className="flex gap-3 mb-6">
        {(['normal', 'henkou', 'torikeshi'] as const).map(t => (
          <div key={t} className={`flex-1 rounded-lg border px-3 py-2 text-center text-xs ${fileTypeBadge[t]} border-current/20`}>
            <div className="font-semibold">{fileTypeOrder[t]}{fileTypeLabel[t]}</div>
          </div>
        ))}
      </div>

      {status === 'processing' && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm font-medium text-gray-700">処理中...</p>
            <p className="text-sm text-gray-400">{progress} / {progressMax}</p>
          </div>
          {currentFile && (
            <p className="text-xs text-gray-400 mb-2 truncate">{currentFile}</p>
          )}
          <div className="w-full bg-gray-100 rounded-full h-2">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all"
              style={{ width: progressMax > 0 ? `${(progress / progressMax) * 100}%` : '0%' }}
            />
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {status === 'done' && results.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-gray-700">処理完了 — {results.length} ファイル</p>
          {results.map((r, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs text-gray-400 font-medium">{fileTypeOrder[r.fileType]}</span>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${fileTypeBadge[r.fileType] ?? 'bg-gray-100 text-gray-600'}`}>
                  {fileTypeLabel[r.fileType] ?? r.fileType}
                </span>
                <p className="text-sm text-gray-700 font-medium truncate">{r.filename}</p>
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div className="text-center">
                  <p className="text-xs text-gray-400 mb-0.5">総行数</p>
                  <p className="text-lg font-semibold text-gray-900">{r.total}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-gray-400 mb-0.5">新規登録</p>
                  <p className="text-lg font-semibold text-blue-600">{r.inserted}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-gray-400 mb-0.5">更新</p>
                  <p className="text-lg font-semibold text-amber-600">{r.updated}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-gray-400 mb-0.5">{r.fileType === 'torikeshi' ? '取消' : 'スキップ'}</p>
                  <p className="text-lg font-semibold text-red-500">{r.fileType === 'torikeshi' ? r.cancelled : r.skipped}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
