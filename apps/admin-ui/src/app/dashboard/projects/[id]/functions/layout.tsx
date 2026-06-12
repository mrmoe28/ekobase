'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useParams } from 'next/navigation'

const subNav = [
  { href: '', label: 'Functions' },
  { href: '/secrets', label: 'Secrets' },
]

export default function ProjectFunctionsLayout({ children }: { children: React.ReactNode }) {
  const { id } = useParams<{ id: string }>()
  const pathname = usePathname()
  const router = useRouter()
  const base = `/dashboard/projects/${id}/functions`

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1 border-b" style={{ borderColor: 'var(--border)' }}>
        {subNav.map(item => {
          const href = base + item.href
          const active = pathname === href
          return (
            <button
              key={item.href}
              onClick={() => router.push(href)}
              className="px-4 py-2.5 text-sm font-medium transition-colors duration-100 relative"
              style={{
                color: active ? 'var(--text)' : 'var(--text-muted)',
              }}
            >
              {item.label}
              {active && (
                <span
                  className="absolute bottom-0 left-0 right-0 h-[2px]"
                  style={{ backgroundColor: 'var(--accent)' }}
                />
              )}
            </button>
          )
        })}
      </div>
      {children}
    </div>
  )
}
