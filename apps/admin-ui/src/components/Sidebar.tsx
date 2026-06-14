'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import {
  LayoutDashboard,
  Users,
  Building2,
  FolderKanban,
  Terminal,
  Table2,
  Zap,
  Plug,
  Settings2,
  Sun,
  Moon,
  LogOut,
  Menu,
  X,
  Sparkles,
} from 'lucide-react'
import { clearToken } from '@/lib/auth'

const navItems = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/dashboard/projects', label: 'Projects', icon: FolderKanban },
  { href: '/dashboard/users', label: 'Users', icon: Users },
  { href: '/dashboard/tenants', label: 'Tenants', icon: Building2 },
  { href: '/dashboard/sql', label: 'SQL Editor', icon: Terminal },
  { href: '/dashboard/tables', label: 'Table Editor', icon: Table2 },
  { href: '/dashboard/functions', label: 'Edge Functions', icon: Zap },
  { href: '/dashboard/integrations', label: 'Integrations', icon: Plug },
  { href: '/dashboard/settings', label: 'Admin Settings', icon: Settings2 },
]

interface SidebarProps {
  mobileOpen: boolean
  onMobileClose: () => void
}

function SidebarContent({ onNav }: { onNav?: () => void }) {
  const pathname = usePathname()
  const router = useRouter()
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  const handleLogout = () => {
    clearToken()
    router.replace('/')
  }

  const isActive = (href: string) => {
    if (href === '/dashboard') return pathname === '/dashboard'
    return pathname.startsWith(href)
  }

  return (
    <div
      className="flex flex-col h-full"
      style={{ backgroundColor: 'var(--sidebar-bg)' }}
    >
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 py-6">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: 'var(--accent)' }}
        >
          <Sparkles size={16} className="text-white dark:text-dark-bg" />
        </div>
        <span className="text-base font-semibold" style={{ color: 'var(--text)' }}>
          Admin
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 space-y-1">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = isActive(href)
          return (
            <button
              key={href}
              onClick={() => {
                router.push(href)
                onNav?.()
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-full text-sm font-medium transition-all duration-150 text-left"
              style={{
                backgroundColor: active
                  ? 'color-mix(in srgb, var(--accent) 20%, transparent)'
                  : 'transparent',
                color: active ? 'var(--accent)' : 'var(--text-muted)',
              }}
              onMouseEnter={(e) => {
                if (!active) {
                  e.currentTarget.style.backgroundColor =
                    'color-mix(in srgb, var(--border) 60%, transparent)'
                  e.currentTarget.style.color = 'var(--text)'
                }
              }}
              onMouseLeave={(e) => {
                if (!active) {
                  e.currentTarget.style.backgroundColor = 'transparent'
                  e.currentTarget.style.color = 'var(--text-muted)'
                }
              }}
            >
              <Icon size={18} />
              {label}
            </button>
          )
        })}
      </nav>

      {/* Bottom controls */}
      <div
        className="px-3 pb-5 pt-3 space-y-1 border-t"
        style={{ borderColor: 'var(--border)' }}
      >
        {mounted && (
          <button
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-full text-sm font-medium transition-all duration-150"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor =
                'color-mix(in srgb, var(--border) 60%, transparent)'
              e.currentTarget.style.color = 'var(--text)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent'
              e.currentTarget.style.color = 'var(--text-muted)'
            }}
          >
            {resolvedTheme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            {resolvedTheme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
        )}
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-full text-sm font-medium transition-all duration-150"
          style={{ color: 'var(--danger)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor =
              'color-mix(in srgb, var(--danger) 12%, transparent)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent'
          }}
        >
          <LogOut size={18} />
          Sign out
        </button>
      </div>
    </div>
  )
}

export default function Sidebar({ mobileOpen, onMobileClose }: SidebarProps) {
  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className="hidden lg:flex flex-col w-60 shrink-0 h-screen sticky top-0"
        style={{
          backgroundColor: 'var(--sidebar-bg)',
          borderRight: '1px solid var(--border)',
        }}
      >
        <SidebarContent />
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={onMobileClose}
        />
      )}

      {/* Mobile sidebar drawer */}
      <aside
        className="fixed top-0 left-0 z-50 h-full w-60 lg:hidden transition-transform duration-150"
        style={{
          backgroundColor: 'var(--sidebar-bg)',
          borderRight: '1px solid var(--border)',
          transform: mobileOpen ? 'translateX(0)' : 'translateX(-100%)',
        }}
      >
        <div className="flex items-center justify-end p-3">
          <button
            onClick={onMobileClose}
            className="p-1.5 rounded-lg"
            style={{ color: 'var(--text-muted)' }}
            aria-label="Close sidebar"
          >
            <X size={18} />
          </button>
        </div>
        <SidebarContent onNav={onMobileClose} />
      </aside>
    </>
  )
}

export function MobileMenuButton({
  onClick,
}: {
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="lg:hidden p-2 rounded-lg transition-colors duration-150"
      style={{ color: 'var(--text-muted)' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor =
          'color-mix(in srgb, var(--border) 60%, transparent)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'transparent'
      }}
      aria-label="Open sidebar"
    >
      <Menu size={20} />
    </button>
  )
}
