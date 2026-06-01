'use client'
import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'

const EDITOR_PIN = '5678'
const GUEST_PIN_LENGTH = 4

export default function LoginPage() {
  const router               = useRouter()
  const { login } = useAuth()

  const [email,        setEmail]        = useState('')
  const [password,     setPassword]     = useState('')
  const [error,        setError]        = useState('')
  const [loading,      setLoading]      = useState(false)

  const [showPin,      setShowPin]      = useState(false)
  const [digits,       setDigits]       = useState(['', '', '', ''])
  const [pinError,     setPinError]     = useState(false)
  const [shake,        setShake]        = useState(false)
  const [guestLoading, setGuestLoading] = useState(false)

  const [showEditorPin,  setShowEditorPin]  = useState(false)
  const [editorDigits,   setEditorDigits]   = useState(['', '', '', ''])
  const [editorPinError, setEditorPinError] = useState(false)
  const [editorShake,    setEditorShake]    = useState(false)
  const [editorLoading,  setEditorLoading]  = useState(false)

  const inputRefs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ]
  const editorInputRefs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ]

  useEffect(() => {
    if (showPin) {
      setDigits(['', '', '', ''])
      setPinError(false)
      setTimeout(() => inputRefs[0].current?.focus(), 50)
    }
  }, [showPin])

  useEffect(() => {
    if (showEditorPin) {
      setEditorDigits(['', '', '', ''])
      setEditorPinError(false)
      setTimeout(() => editorInputRefs[0].current?.focus(), 50)
    }
  }, [showEditorPin])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await login(email, password)
      router.replace('/dashboard')
    } catch (err: any) {
      setError(err.message || 'ログインに失敗しました')
      setLoading(false)
    }
  }

  function handleDigit(idx: number, val: string) {
    if (!/^\d?$/.test(val)) return
    const next = [...digits]
    next[idx] = val.slice(-1)
    setDigits(next)
    setPinError(false)
    if (val && idx < 3) inputRefs[idx + 1].current?.focus()
    if (val && idx === 3) {
      const pin = [...next.slice(0, 3), val.slice(-1)].join('')
      if (pin.length === 4) checkPin(pin)
    }
  }

  function handleKeyDown(idx: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[idx] && idx > 0) inputRefs[idx - 1].current?.focus()
    if (e.key === 'Escape') setShowPin(false)
    if (e.key === 'Enter') { const pin = digits.join(''); if (pin.length === 4) checkPin(pin) }
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4)
    if (!pasted.length) return
    const next = ['', '', '', '']
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i]
    setDigits(next)
    if (pasted.length === 4) setTimeout(() => checkPin(pasted), 0)
    else inputRefs[pasted.length]?.current?.focus()
  }

  function triggerShake() {
    setShake(true); setPinError(true)
    setTimeout(() => {
      setShake(false); setDigits(['', '', '', '']); setPinError(false)
      inputRefs[0].current?.focus()
    }, 600)
  }

  async function checkPin(pin: string) {
    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) { triggerShake(); return }
    setGuestLoading(true)
    try {
      localStorage.setItem('bq_user', JSON.stringify({ email: 'guest', name: 'ゲスト', role: 'guest' }))
      router.replace('/dashboard')
    } catch (err: any) {
      setError(err.message || 'ゲストログインに失敗しました')
      setShowPin(false)
      setGuestLoading(false)
    }
  }

  function handleEditorDigit(idx: number, val: string) {
    if (!/^\d?$/.test(val)) return
    const next = [...editorDigits]
    next[idx] = val.slice(-1)
    setEditorDigits(next)
    setEditorPinError(false)
    if (val && idx < 3) editorInputRefs[idx + 1].current?.focus()
    if (val && idx === 3) {
      const pin = [...next.slice(0, 3), val.slice(-1)].join('')
      if (pin.length === 4) checkEditorPin(pin)
    }
  }

  function handleEditorKeyDown(idx: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !editorDigits[idx] && idx > 0) editorInputRefs[idx - 1].current?.focus()
    if (e.key === 'Escape') setShowEditorPin(false)
    if (e.key === 'Enter') { const pin = editorDigits.join(''); if (pin.length === 4) checkEditorPin(pin) }
  }

  function handleEditorPaste(e: React.ClipboardEvent) {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4)
    if (!pasted.length) return
    const next = ['', '', '', '']
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i]
    setEditorDigits(next)
    if (pasted.length === 4) setTimeout(() => checkEditorPin(pasted), 0)
    else editorInputRefs[pasted.length]?.current?.focus()
  }

  function triggerEditorShake() {
    setEditorShake(true); setEditorPinError(true)
    setTimeout(() => {
      setEditorShake(false); setEditorDigits(['', '', '', '']); setEditorPinError(false)
      editorInputRefs[0].current?.focus()
    }, 600)
  }

  async function checkEditorPin(pin: string) {
    if (pin !== EDITOR_PIN) { triggerEditorShake(); return }
    setEditorLoading(true)
    try {
      localStorage.setItem('bq_user', JSON.stringify({ email: 'editor', name: '製造スケジュール編集者', role: 'editor' }))
      router.replace('/dashboard')
    } catch (err: any) {
      setError(err.message || 'ログインに失敗しました')
      setShowEditorPin(false)
      setEditorLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 w-full max-w-sm">
        <h1 className="text-xl font-semibold text-gray-900 mb-1">EDI Manager</h1>
        <p className="text-sm text-gray-500 mb-6">ログインしてください</p>
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">メールアドレス</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="you@example.com" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">パスワード</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="••••••••" />
          </div>
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <button type="submit" disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg py-2 text-sm transition-colors">
            {loading ? 'ログイン中...' : 'ログイン'}
          </button>
        </form>
        <div className="mt-4 pt-4 border-t border-gray-100">
          <button onClick={() => setShowPin(true)} disabled={guestLoading}
            className="w-full border border-gray-200 hover:border-gray-300 text-gray-600 hover:text-gray-800 font-medium rounded-lg py-2 text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            <span>👁</span>
            {guestLoading ? '接続中...' : 'ゲストとして閲覧'}
          </button>
          <p className="text-xs text-gray-400 text-center mt-2">閲覧のみ・編集不可</p>
        </div>
        <div className="mt-3">
          <button onClick={() => setShowEditorPin(true)} disabled={editorLoading}
            className="w-full border border-emerald-200 hover:border-emerald-300 text-emerald-700 hover:text-emerald-800 font-medium rounded-lg py-2 text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            <span>⚙</span>
            {editorLoading ? '接続中...' : '製造担当としてログイン'}
          </button>
          <p className="text-xs text-gray-400 text-center mt-2">製造スケジュール編集可</p>
        </div>
      </div>

      {showPin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-xs text-center">
            <p className="text-sm font-semibold text-gray-800 mb-1">ゲスト閲覧</p>
            <p className="text-xs text-gray-400 mb-6">パスワードを入力してください</p>
            <div className="flex justify-center gap-3 mb-5"
              style={shake ? { animation: 'shake 0.4s ease-in-out' } : {}}>
              <style>{`@keyframes shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-8px)}40%{transform:translateX(8px)}60%{transform:translateX(-5px)}80%{transform:translateX(5px)}}`}</style>
              {digits.map((d, i) => (
                <input key={i} ref={inputRefs[i]} type="password" inputMode="numeric" maxLength={1}
                  value={d} onChange={e => handleDigit(i, e.target.value)}
                  onKeyDown={e => handleKeyDown(i, e)} onPaste={handlePaste}
                  disabled={guestLoading} style={{ width: 52, height: 52 }}
                  className={`text-center text-2xl font-bold rounded-xl border-2 focus:outline-none transition-all ${pinError ? 'border-red-400 bg-red-50 text-red-600' : d ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-200 bg-gray-50 text-gray-900 focus:border-blue-400 focus:bg-white'}`} />
              ))}
            </div>
            {pinError && <p className="text-xs text-red-500 mb-3">パスワードが正しくありません</p>}
            <button onClick={() => setShowPin(false)} className="text-xs text-gray-400 hover:text-gray-600">キャンセル</button>
          </div>
        </div>
      )}

      {showEditorPin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-xs text-center">
            <p className="text-sm font-semibold text-gray-800 mb-1">製造担当ログイン</p>
            <p className="text-xs text-gray-400 mb-6">パスワードを入力してください</p>
            <div className="flex justify-center gap-3 mb-5"
              style={editorShake ? { animation: 'shake 0.4s ease-in-out' } : {}}>
              {editorDigits.map((d, i) => (
                <input key={i} ref={editorInputRefs[i]} type="password" inputMode="numeric" maxLength={1}
                  value={d} onChange={e => handleEditorDigit(i, e.target.value)}
                  onKeyDown={e => handleEditorKeyDown(i, e)} onPaste={handleEditorPaste}
                  disabled={editorLoading} style={{ width: 52, height: 52 }}
                  className={`text-center text-2xl font-bold rounded-xl border-2 focus:outline-none transition-all ${editorPinError ? 'border-red-400 bg-red-50 text-red-600' : d ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-gray-200 bg-gray-50 text-gray-900 focus:border-emerald-400 focus:bg-white'}`} />
              ))}
            </div>
            {editorPinError && <p className="text-xs text-red-500 mb-3">パスワードが正しくありません</p>}
            <button onClick={() => setShowEditorPin(false)} className="text-xs text-gray-400 hover:text-gray-600">キャンセル</button>
          </div>
        </div>
      )}
    </div>
  )
}