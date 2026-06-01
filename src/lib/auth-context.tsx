'use client'
import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

interface User {
  email: string
  name: string
  role: 'admin' | 'editor' | 'guest'
}

interface AuthContextType {
  user: User | null
  loading: boolean
  isGuest: boolean
  isEditor: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

const USERS: Record<string, { password: string; name: string; role: 'admin' | 'editor' | 'guest' }> = {
  'admin@test.com':              { password: 'admin123', name: 'Admin User',      role: 'admin' },
  'kinugasa.hirata@gmail.com':   { password: 'admin123', name: 'Shuhei Kinugasa', role: 'admin' },
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,    setUser]    = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const saved = localStorage.getItem('bq_user')
    if (saved) setUser(JSON.parse(saved))
    setLoading(false)
  }, [])

  async function login(email: string, password: string) {
    const found = USERS[email]
    if (!found || found.password !== password) {
      throw new Error('メールアドレスまたはパスワードが違います')
    }
    const u = { email, name: found.name, role: found.role }
    setUser(u)
    localStorage.setItem('bq_user', JSON.stringify(u))
  }

  async function logout() {
    setUser(null)
    localStorage.removeItem('bq_user')
  }

  const isGuest  = user?.role === 'guest'
  const isEditor = user?.role === 'editor'

  return (
    <AuthContext.Provider value={{ user, loading, isGuest, isEditor, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}