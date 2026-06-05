'use client'

import { usePathname, useRouter } from 'next/navigation'
import {
  ArrowLeft, LayoutDashboard, Table2, Terminal, Database,
  Shield, HardDrive, Zap, Radio, ScrollText, Plug, Settings, Link,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

type Tab = { href: string; label: string; icon: LucideIcon }

const TABS: Tab[] = [
  { href: '', label: 'Overview', icon: LayoutDashboard },
  { href: '/editor', label: 'Table Editor', icon: Table2 },
  { href: '/sql', label: 'SQL Editor', icon: Terminal },
  { href: '/database', label: 'Database', icon: Database },
  { href: '/auth', label: 'Authentication', icon: Shield },
  { href: '/storage', label: 'Storage', icon: HardDrive },
  { href: '/functions', label: 'Edge Functions', icon: Zap },
  { href: '/realtime', label: 'Realtime', icon: Radio },
  { href: '/logs', label: 'Logs', icon: ScrollText },
  { href: '/integrations', label: 'Integrations', icon: Plug },
  { href: '/connections', label: 'Connection Strings', icon: Link },
]

const SETTINGS_TAB: Tab = { href: '/settings', label: 'Project Settings', icon: Settings }

export default function ProjectSidebar({
  projectId,
  projectName,
}: {
  projectId: string
  projectName?: string
}) {
  const pathname = usePathname()
  const router = useRouter()
  const base = `/dashboard/projects/${projectId}`

  const isActive = (suffix: string) =>
    suffix === '' ? pathname === base : pathname.startsWith(base + suffix)

  const renderTab = ({ href, label, icon: Icon }: Tab) => {
    const active = isActive(href)
    return (
      <button
        key={href}
        onClick={() => router.push(base + href)}
        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-100 text-left"
        style={{
          backgroundColor: active
            ? 'color-mix(in srgb, var(--accent) 15%, transparent)'
            : 'transparent',
          color: active ? 'var(--accent)' : 'var(--text-muted)',
        }}
        onMouseEnter={e => {
          if (!active) {
            e.currentTarget.style.backgroundColor =
              'color-mix(in srgb, var(--border) 50%, transparent)'
            e.currentTarget.style.color = 'var(--text)'
          }
        }}
        onMouseLeave={e => {
          if (!active) {
            e.currentTarget.style.backgroundColor = 'transparent'
            e.currentTarget.style.color = 'var(--text-muted)'
          }
        }}
      >
        <Icon size={15} />
        {label}
      </button>
    )
  }

  return (
    <aside
      className="hidden lg:flex flex-col w-52 shrink-0 border-r"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--sidebar-bg)' }}
    >
      <div className="px-3 pt-4 pb-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <button
          onClick={() => router.push('/dashboard/projects')}
          className="flex items-center gap-1.5 text-xs mb-3 transition-colors duration-100"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}
        >
          <ArrowLeft size={13} />
          All projects
        </button>
        <p
          className="text-sm font-semibold truncate leading-tight"
          style={{ color: 'var(--text)' }}
        >
          {projectName ?? '…'}
        </p>
      </div>

      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {TABS.map(renderTab)}
      </nav>

      <div className="p-2 border-t" style={{ borderColor: 'var(--border)' }}>
        {renderTab(SETTINGS_TAB)}
      </div>
    </aside>
  )
}
