'use client'

import { useState, useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import AuthGuard from '@/components/auth-guard'
import { StockProvider, useStock, calculateDailyStock } from '@/lib/stock-context'

// ── Icons ────────────────────────────────────────────────────────────────────
function IconChevron({ open }: { open: boolean }) {
  return (
    <svg className={`w-3 h-3 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  )
}
function IconDot({ active }: { active: boolean }) {
  return <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 transition-colors ${active ? 'bg-blue-500' : 'bg-gray-300'}`} />
}

// ── Types ────────────────────────────────────────────────────────────────────
// EDIT 1: NavItem now has optional editorHidden so individual items can be
// hidden from editors without hiding the whole section
interface NavItem {
  label: string
  href: string
  editorHidden?: boolean
}
interface NavSection {
  id: string; label: string; emoji: string
  color: string; bg: string; items: NavItem[]
  guestHidden?:  boolean
  editorHidden?: boolean
}

// ── Nav structure ─────────────────────────────────────────────────────────────
// EDIT 2: orders section — remove editorHidden from the section itself,
// move it to individual items (EDI upload and master) so editors see 注文一覧
const NAV_SECTIONS: NavSection[] = [
  {
    id: 'mfg-lot', label: '製造番号別', emoji: '📊', color: 'text-indigo-700', bg: 'bg-indigo-50',
    items: [
      { label: '製造番号サマリ',       href: '/dashboard/mfg-lot' },
      { label: '材料配分シミュレーター', href: '/dashboard/mfg-lot/allocation' },
    ],
  },
  {
    id: 'orders', label: '受注管理', emoji: '📦', color: 'text-blue-700', bg: 'bg-blue-50',
    guestHidden: true,
    // editorHidden removed from section — editors can see 注文一覧
    items: [
      { label: '注文一覧',        href: '/dashboard/orders' },
      { label: 'EDI アップロード', href: '/dashboard/upload', editorHidden: true },
      { label: 'マスタ管理',      href: '/dashboard/master', editorHidden: true },
    ],
  },
  {
    id: 'manufacturing', label: '製造スケジュール', emoji: '🏭', color: 'text-emerald-700', bg: 'bg-emerald-50',
    guestHidden: true,
    items: [
      { label: 'スケジュール表', href: '/dashboard/manufacturing' },
      { label: '製造計画',       href: '/dashboard/manufacturing/production' },
    ],
  },
  {
    id: 'material', label: '原材料入荷', emoji: '🚢', color: 'text-violet-700', bg: 'bg-violet-50',
    items: [
      { label: '入荷スケジュール', href: '/dashboard/material' },
    ],
  },
]

// ── Background stock calculator ───────────────────────────────────────────────
function BackgroundStockCalculator() {
  const { setDailyStock } = useStock()

  useEffect(() => {
    async function calculate() {
      const result = await calculateDailyStock()
      if (result) setDailyStock(result)
    }
    const timer    = setTimeout(calculate, 300)
    return () => { clearTimeout(timer) }
  }, [setDailyStock])

  return null
}

// ── Sidebar ──────────────────────────────────────────────────────────────────
function Sidebar() {
  const pathname = usePathname()
  const { user, logout, isGuest, isEditor } = useAuth()
  const { dailyStock, clearStock } = useStock()
  const router = useRouter()
  const [refreshing, setRefreshing] = useState(false)

  async function handleRefreshStock() {
    setRefreshing(true)
    clearStock()
    await new Promise(r => setTimeout(r, 1500))
    setRefreshing(false)
  }

  const visibleSections = NAV_SECTIONS.filter(s => {
    if (isGuest  && s.guestHidden)  return false
    if (isEditor && s.editorHidden) return false
    return true
  })

  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => {
    const active = visibleSections.find(s => s.items.some(i => pathname.startsWith(i.href)))
    const init: Record<string, boolean> = {}
    for (const s of NAV_SECTIONS) { init[s.id] = s.id === (active?.id ?? 'material') }
    return init
  })

  useEffect(() => {
    const active = visibleSections.find(s => s.items.some(i => pathname.startsWith(i.href)))
    if (active) setOpenSections(prev => ({ ...prev, [active.id]: true }))
  }, [pathname])

  function toggleSection(id: string) {
    setOpenSections(prev => ({ ...prev, [id]: !prev[id] }))
  }

  async function handleLogout() {
    await logout()
    router.push('/login')
  }

  const stockDateLabel = dailyStock
    ? (() => {
        const d = dailyStock.calculatedAt
        return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
      })()
    : null

  return (
    <aside className="w-56 flex-shrink-0 h-screen sticky top-0 flex flex-col bg-white border-r border-gray-100">
      <div className="px-5 py-4 border-b border-gray-100">
        <span className="text-sm font-semibold text-gray-900 tracking-tight">EDI Manager</span>
        {isGuest && (
          <span className="ml-2 text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">閲覧専用</span>
        )}
        {isEditor && (
          <span className="ml-2 text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">製造担当</span>
        )}
      </div>

      {/* Dashboard link */}
      <div className="px-3 pt-3">
        <button onClick={() => router.push('/dashboard')}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
            pathname === '/dashboard'
              ? 'bg-gray-100 text-gray-900 font-medium'
              : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
          }`}>
          <span className="text-base">📈</span>
          <span>ダッシュボード</span>
        </button>
      </div>

      <div className="mx-4 my-2 border-t border-gray-100" />

      {/* Nav sections */}
      <nav className="flex-1 overflow-y-auto px-3 pb-3 space-y-1">
        {visibleSections.map(section => {
          const isOpen   = openSections[section.id]
          const isActive = section.items.some(i => pathname.startsWith(i.href))

          // EDIT 3: filter out items that are editorHidden when user is editor
          const visibleItems = section.items.filter(item => !(isEditor && item.editorHidden))

          return (
            <div key={section.id}>
              <button onClick={() => toggleSection(section.id)}
                className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-semibold tracking-wide transition-colors ${
                  isActive && !isOpen ? 'text-gray-900 bg-gray-50' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}>
                <span className={`text-sm w-6 h-6 flex items-center justify-center rounded-md flex-shrink-0 ${section.bg}`}>
                  {section.emoji}
                </span>
                <span className="flex-1 text-left">{section.label}</span>
                {isActive && !isOpen && <IconDot active />}
                <IconChevron open={isOpen} />
              </button>
              {isOpen && (
                <div className="mt-0.5 ml-3 pl-3 border-l border-gray-100 space-y-0.5">
                  {visibleItems.map(item => {
                    const active = pathname === item.href || pathname.startsWith(item.href + '/')
                    return (
                      <button key={item.href} onClick={() => router.push(item.href)}
                        className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm transition-colors ${
                          active ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                        }`}>
                        <IconDot active={active} />
                        {item.label}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}

        {/* Hidden sections shown greyed out with lock icon */}
        {(isGuest || isEditor) && NAV_SECTIONS.filter(s =>
          (isGuest  && s.guestHidden) ||
          (isEditor && s.editorHidden)
        ).map(section => (
          <div key={section.id} className="opacity-40 cursor-not-allowed">
            <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-semibold text-gray-400">
              <span className={`text-sm w-6 h-6 flex items-center justify-center rounded-md flex-shrink-0 ${section.bg}`}>
                {section.emoji}
              </span>
              <span className="flex-1 text-left">{section.label}</span>
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
          </div>
        ))}
      </nav>

      {/* Guide link — pinned above footer */}
      <div className="px-3 pb-2">
        <button onClick={() => router.push('/dashboard/guide')}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
            pathname === '/dashboard/guide'
              ? 'bg-gray-100 text-gray-900'
              : 'text-gray-400 hover:bg-gray-50 hover:text-gray-600'
          }`}>
          <span>📖</span>
          <span>使い方ガイド</span>
        </button>
      </div>

      {/* User / logout */}
      <div className="border-t border-gray-100 px-4 py-3">
        <p className="text-xs text-gray-400 truncate mb-2">
          {isGuest ? '👁 ゲスト閲覧中' : isEditor ? '🏭 製造担当者' : user?.email}
        </p>
        <button onClick={handleRefreshStock} disabled={refreshing}
          className="w-full flex items-center justify-center gap-1.5 text-xs text-blue-500 hover:text-blue-700 border border-blue-100 hover:border-blue-300 rounded-lg py-1.5 mb-1.5 transition-colors disabled:opacity-50">
          <svg className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {refreshing ? '在庫計算中...' : '在庫を再計算'}
        </button>
        {stockDateLabel && (
          <p className="text-[10px] text-gray-300 text-center mb-1.5">
            {stockDateLabel} 更新
          </p>
        )}
        <button onClick={handleLogout}
          className="w-full flex items-center justify-center gap-1.5 text-xs text-gray-500 hover:text-red-600 border border-gray-200 hover:border-red-200 rounded-lg py-1.5 transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h6a2 2 0 012 2v1" />
          </svg>
          {isGuest || isEditor ? 'ログイン画面へ' : 'ログアウト'}
        </button>
      </div>
    </aside>
  )
}

// ── Layout ───────────────────────────────────────────────────────────────────
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <StockProvider>
        <BackgroundStockCalculator />
        <div className="flex min-h-screen bg-gray-50">
          <Sidebar />
          <main className="flex-1 min-w-0 overflow-hidden h-screen">
            {children}
          </main>
        </div>
      </StockProvider>
    </AuthGuard>
  )
}
