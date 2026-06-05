'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { Loader2, Copy, Check, Eye, EyeOff, Link, Globe, Terminal, Code2, Database as DatabaseIcon } from 'lucide-react'
import Toast, { type ToastType } from '@/components/Toast'

const CONNECTION_TYPES = [
  {
    id: 'direct',
    name: 'Direct Connection',
    icon: DatabaseIcon,
    description: 'Direct PostgreSQL connection string for your application.',
    template: 'postgres://postgres:[db-password]@supabase.ekodevops.com:5432/postgres',
    priority: 1,
  },
  {
    id: 'connection-pooler',
    name: 'Connection Pooler',
    icon: Terminal,
    description: 'Connection pooling via PgBouncer for high-concurrency applications.',
    template: 'postgres://postgres.[project-ref]:[db-password]@aws-0-us-east-1.pooler.supabase.ekodevops.com:6543/postgres',
    priority: 2,
  },
]

interface ToastState { message: string; type: ToastType; id: number }

export default function ConnectionStringsPage() {
  const { id } = useParams<{ id: string }>()
  const projectRef = `proj_${id.replace(/-/g, '').slice(0, 16)}`
  const [toast, setToast] = useState<ToastState | null>(null)
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})
  const [copied, setCopied] = useState<string | null>(null)

  const showToast = (message: string, type: ToastType) =>
    setToast({ message, type, id: Date.now() })

  const getConnectionUrl = (type: string): string => {
    const connection = CONNECTION_TYPES.find(c => c.id === type)
    if (!connection) return ''

    return connection.template
      .replace('[project-ref]', projectRef)
  }

  const copy = async (url: string, label: string) => {
    await navigator.clipboard.writeText(url)
    setCopied(label)
    showToast(`${label} copied to clipboard`, 'success')
    setTimeout(() => setCopied(null), 2000)
  }

  const toggleReveal = (id: string) => {
    setRevealed(prev => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 15%, transparent)' }}>
          <Link size={16} style={{ color: 'var(--accent)' }} />
        </div>
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text)' }}>Connection Strings</h1>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Connect your application to this project's database
          </p>
        </div>
      </div>

      <div className="card p-5" style={{ border: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2 mb-4">
          <Globe size={16} style={{ color: 'var(--accent)' }} />
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Project Reference</h2>
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 px-3 py-2 rounded-lg font-mono text-xs"
            style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
            {projectRef}
          </code>
          <button onClick={() => copy(projectRef, 'Project Reference')}
            className="p-2 rounded-lg transition-colors duration-150"
            style={{ border: '1px solid var(--border)', color: copied === 'Project Reference' ? 'var(--accent)' : 'var(--text-muted)' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)' }}>
            {copied === 'Project Reference' ? <Check size={15} /> : <Copy size={15} />}
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {CONNECTION_TYPES.sort((a, b) => a.priority - b.priority).map(conn => {
          const Icon = conn.icon
          const url = getConnectionUrl(conn.id)
          const isRevealed = revealed[conn.id]

          return (
            <div key={conn.id} className="card p-5 space-y-4" style={{ border: '1px solid var(--border)' }}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center mt-0.5"
                    style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 10%, transparent)' }}>
                    <Icon size={16} style={{ color: 'var(--accent)' }} />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--text)' }}>{conn.name}</h3>
                    <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>{conn.description}</p>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="label">Connection URI</label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 relative">
                    <div className="flex items-center rounded-xl px-3 py-2 font-mono text-xs overflow-hidden"
                      style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                      <span className="truncate">
                        {isRevealed ? url : url.replace(/[a-zA-Z0-9]+:[\w-]+@/g, '•••:••••@')}
                      </span>
                    </div>
                  </div>
                  <button onClick={() => toggleReveal(conn.id)}
                    className="p-2 rounded-xl"
                    style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                    {isRevealed ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                  <button onClick={() => copy(url, conn.name)}
                    className="p-2 rounded-xl"
                    style={{ border: '1px solid var(--border)', color: copied === conn.name ? 'var(--accent)' : 'var(--text-muted)' }}>
                    {copied === conn.name ? <Check size={15} /> : <Copy size={15} />}
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="card p-5" style={{ border: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2 mb-3">
          <Code2 size={16} style={{ color: 'var(--accent)' }} />
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Environment Variables</h3>
        </div>
        <div className="space-y-3">
          {CONNECTION_TYPES.map(conn => (
            <div key={`env-${conn.id}`} className="space-y-1">
              <label className="label">{conn.id === 'direct' ? 'DATABASE_URL' : 'DATABASE_POOLER_URL'}</label>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 rounded-lg font-mono text-xs truncate"
                  style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                  {getConnectionUrl(conn.id)}
                </code>
                <button onClick={() => copy(`${conn.id === 'direct' ? 'DATABASE_URL' : 'DATABASE_POOLER_URL'}=${getConnectionUrl(conn.id)}`, 'Environment Variable')}
                  className="p-2 rounded-lg transition-colors duration-150"
                  style={{ border: '1px solid var(--border)', color: copied === 'Environment Variable' ? 'var(--accent)' : 'var(--text-muted)' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)' }}>
                  {copied === 'Environment Variable' ? <Check size={15} /> : <Copy size={15} />}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
        <p className="font-medium mb-2">Security Note:</p>
        <ul className="list-disc list-inside space-y-1">
          <li>Replace <code>[db-password]</code> with your database password</li>
          <li>Use connection pooling for production applications with high concurrent requests</li>
          <li>Keep connection strings and passwords secure and never expose them in client-side code</li>
        </ul>
      </div>

      {toast && (
        <Toast key={toast.id} message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />
      )}
    </div>
  )
}