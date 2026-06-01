'use client'

import { useAuth } from '@/lib/auth-context'
import { useRouter, usePathname } from 'next/navigation'
import { useEffect } from 'react'

// Pages guests (view-only anonymous) are allowed to visit
const GUEST_ALLOWED = [
  '/dashboard',
  '/dashboard/material',
  '/dashboard/guide',
]

// Pages editors (manufacturing anonymous) are allowed to visit
const EDITOR_ALLOWED = [
  '/dashboard',
  '/dashboard/manufacturing',
  '/dashboard/orders',
  '/dashboard/guide',
]

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading, isGuest, isEditor } = useAuth()
  const router   = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (loading) return
    if (!user) {
      router.push('/login')
      return
    }
    if (isGuest) {
      const allowed = GUEST_ALLOWED.some(p => pathname === p || pathname.startsWith(p + '/'))
      if (!allowed) router.replace('/dashboard')
    }
    if (isEditor) {
      const allowed = EDITOR_ALLOWED.some(p => pathname === p || pathname.startsWith(p + '/'))
      if (!allowed) router.replace('/dashboard')
    }
  }, [user, loading, isGuest, isEditor, pathname, router])

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-sm text-gray-400">読み込み中...</div>
      </div>
    )
  }

  return <>{children}</>
}