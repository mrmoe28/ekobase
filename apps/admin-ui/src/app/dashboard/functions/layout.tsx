'use client'

import { usePathname, useRouter } from 'next/navigation'

const subNav = [
  { href: '/dashboard/functions', label: 'Functions' },
  { href: '/dashboard/functions/secrets', label: 'Secrets' },
]

export default function FunctionsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()

  return (
    <div className="flex gap-0 -mx-6 -mt-6 min-h-[calc(100vh-4rem)]">
      {/* Sub-sidebar */}
      <aside
        className="w-48 shrink-0 pt-6 pb-4 px-3 flex flex-col gap-1"
        style={{ borderRight: '1px solid var(--border)', backgroundColor: 'var(--sidebar-bg)' }}
      >
        <p className="text-xs font-semibold uppercase tracking-widest px-3 pb-2"
          style={{ color: 'var(--text-muted)' }}>
          Manage
        </p>
        {subNav.map(item => {
          const active = pathname === item.href
          return (
            <button
              key={item.href}
              onClick={() => router.push(item.href)}
              className="w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-100"
              style={{
                backgroundColor: active ? 'color-mix(in srgb, var(--border) 80%, transparent)' : 'transparent',
                color: active ? 'var(--text)' : 'var(--text-muted)',
              }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.backgroundColor = 'color-mix(in srgb, var(--border) 50%, transparent)' }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.backgroundColor = 'transparent' }}
            >
              {item.label}
            </button>
          )
        })}
      </aside>

      {/* Page content */}
      <div className="flex-1 p-8 overflow-auto">
        {children}
      </div>
    </div>
  )
}
