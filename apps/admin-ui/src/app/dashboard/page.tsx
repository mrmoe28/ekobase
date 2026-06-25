'use client'

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Server, Database, CheckCircle2, XCircle, AlertCircle, Loader2 } from 'lucide-react'
import {
  getContainerHealth, getDatabaseHealth, syncSchemas,
  type ContainerHealth, type DatabaseHealth,
} from '@/lib/api'
import Toast, { type ToastType } from '@/components/Toast'

interface ToastState { message: string; type: ToastType; id: number }

function statusColor(state: string) {
  if (state === 'running') return '#22c55e'
  if (state === 'exited') return 'var(--danger)'
  return '#f59e0b'
}

function StatusIcon({ state }: { state: string }) {
  if (state === 'running') return <CheckCircle2 size={14} style={{ color: statusColor(state) }} />
  if (state === 'exited') return <XCircle size={14} style={{ color: statusColor(state) }} />
  return <AlertCircle size={14} style={{ color: statusColor(state) }} />
}

function formatUptime(seconds: number) {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${h}h ${m}m`
}

export default function OverviewPage() {
  const [containers, setContainers] = useState<ContainerHealth[]>([])
  const [db, setDb] = useState<DatabaseHealth | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)

  const showToast = (message: string, type: ToastType) =>
    setToast({ message, type, id: Date.now() })

  const load = useCallback(async () => {
    try {
      const [c, d] = await Promise.all([getContainerHealth(), getDatabaseHealth()])
      setContainers(c)
      setDb(d)
      setLastRefresh(new Date())
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to load health data', 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const interval = setInterval(load, 30_000)
    return () => clearInterval(interval)
  }, [load])

  const handleSync = async () => {
    setSyncing(true)
    try {
      const result = await syncSchemas()
      showToast(`Synced ${result.total} schema${result.total !== 1 ? 's' : ''} with PostgREST`, 'success')
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Sync failed', 'error')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {toast && <Toast key={toast.id} message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--text)' }}>System Health</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {lastRefresh ? `Last updated ${lastRefresh.toLocaleTimeString()}` : 'Loading…'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium"
            style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', opacity: syncing ? 0.6 : 1 }}
          >
            {syncing ? <Loader2 size={13} className="animate-spin" /> : null}
            Sync Schemas
          </button>
          <button
            onClick={() => { setLoading(true); load() }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium"
            style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }}
          >
            <RefreshCw size={13} />
            Refresh
          </button>
        </div>
      </div>

      <div className="rounded-xl" style={{ border: '1px solid var(--border)', backgroundColor: 'var(--surface)' }}>
        <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
          <Server size={15} style={{ color: 'var(--accent)' }} />
          <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Containers</span>
        </div>
        {loading ? (
          <div className="flex items-center justify-center h-24">
            <Loader2 size={20} className="animate-spin" style={{ color: 'var(--accent)' }} />
          </div>
        ) : containers.length === 0 ? (
          <p className="px-4 py-6 text-sm text-center" style={{ color: 'var(--text-muted)' }}>
            No infra containers found — is Docker socket mounted?
          </p>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {containers.map(c => (
              <div key={c.name} className="flex items-center gap-3 px-4 py-3">
                <StatusIcon state={c.state} />
                <span className="text-sm font-mono font-medium flex-1" style={{ color: 'var(--text)' }}>
                  {c.name.replace('infra-', '')}
                </span>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{c.status}</span>
                {c.state === 'running' && (
                  <>
                    <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>up {formatUptime(c.uptime_seconds)}</span>
                    <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>CPU {c.cpu_percent.toFixed(1)}%</span>
                    <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{c.memory_mb} / {c.memory_limit_mb} MB</span>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {db && (
        <div className="rounded-xl" style={{ border: '1px solid var(--border)', backgroundColor: 'var(--surface)' }}>
          <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
            <Database size={15} style={{ color: 'var(--accent)' }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Database</span>
            <span className="text-xs ml-auto font-mono" style={{ color: 'var(--text-muted)' }}>
              {db.active_connections} active / {db.total_connections} total · {db.total_size}
            </span>
          </div>
          {db.schemas.length > 0 ? (
            <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {db.schemas.map(s => (
                <div key={s.schema} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="text-xs font-mono flex-1" style={{ color: 'var(--text)' }}>{s.schema}</span>
                  <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{s.size}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="px-4 py-4 text-sm" style={{ color: 'var(--text-muted)' }}>No project schemas yet.</p>
          )}
        </div>
      )}
    </div>
  )
}
