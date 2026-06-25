'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { GitBranch, Plus, Play, RotateCcw, Trash2, Loader2, ChevronDown, ChevronRight } from 'lucide-react'
import {
  listMigrations, createMigration, applyMigration, rollbackMigration, deleteMigration,
  type Migration,
} from '@/lib/api'
import Modal from '@/components/Modal'
import Toast, { type ToastType } from '@/components/Toast'

interface ToastState { message: string; type: ToastType; id: number }

function StatusBadge({ status }: { status: Migration['status'] }) {
  const styles: Record<Migration['status'], { bg: string; color: string }> = {
    pending:     { bg: 'color-mix(in srgb, #f59e0b 15%, transparent)', color: '#f59e0b' },
    applied:     { bg: 'color-mix(in srgb, #22c55e 15%, transparent)', color: '#22c55e' },
    failed:      { bg: 'color-mix(in srgb, var(--danger) 15%, transparent)', color: 'var(--danger)' },
    rolled_back: { bg: 'color-mix(in srgb, var(--text-muted) 20%, transparent)', color: 'var(--text-muted)' },
  }
  const s = styles[status] ?? styles.pending
  return (
    <span className="text-xs px-2 py-0.5 rounded font-mono"
      style={{ backgroundColor: s.bg, color: s.color }}>{status}</span>
  )
}

export default function ProjectMigrationsPage() {
  const { id } = useParams<{ id: string }>()

  const [migrations, setMigrations] = useState<Migration[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', sql: '' })
  const [creating, setCreating] = useState(false)
  const [applying, setApplying] = useState<string | null>(null)
  const [rollingBack, setRollingBack] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)

  const showToast = (message: string, type: ToastType) =>
    setToast({ message, type, id: Date.now() })

  useEffect(() => {
    listMigrations(id)
      .then(setMigrations)
      .catch(() => showToast('Failed to load migrations', 'error'))
      .finally(() => setLoading(false))
  }, [id])

  const handleCreate = async () => {
    if (!form.name.trim() || !form.sql.trim()) return
    setCreating(true)
    try {
      const m = await createMigration(id, { name: form.name.trim(), sql: form.sql.trim() })
      setMigrations(prev => [m, ...prev])
      showToast('Migration created', 'success')
      setShowCreate(false)
      setForm({ name: '', sql: '' })
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to create', 'error')
    } finally {
      setCreating(false)
    }
  }

  const handleApply = async (mid: string) => {
    setApplying(mid)
    try {
      const updated = await applyMigration(id, mid)
      setMigrations(prev => prev.map(m => m.id === mid ? updated : m))
      showToast('Migration applied', 'success')
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Apply failed', 'error')
    } finally {
      setApplying(null)
    }
  }

  const handleRollback = async (mid: string) => {
    setRollingBack(mid)
    try {
      const updated = await rollbackMigration(id, mid)
      setMigrations(prev => prev.map(m => m.id === mid ? updated : m))
      showToast('Migration rolled back', 'success')
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Rollback failed', 'error')
    } finally {
      setRollingBack(null)
    }
  }

  const handleDelete = async (mid: string) => {
    setDeleting(mid)
    try {
      await deleteMigration(id, mid)
      setMigrations(prev => prev.filter(m => m.id !== mid))
      showToast('Migration deleted', 'success')
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Delete failed', 'error')
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      {toast && <Toast key={toast.id} message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 15%, transparent)' }}>
            <GitBranch size={16} style={{ color: 'var(--accent)' }} />
          </div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text)' }}>Migrations</h1>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium"
          style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 15%, transparent)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)' }}>
          <Plus size={13} /> New migration
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 size={22} className="animate-spin" style={{ color: 'var(--accent)' }} />
        </div>
      ) : migrations.length === 0 ? (
        <div className="card p-8 text-center" style={{ border: '1px solid var(--border)' }}>
          <GitBranch size={32} className="mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            No migrations yet. Create one to track schema changes.
          </p>
        </div>
      ) : (
        <div className="rounded-xl divide-y"
          style={{ border: '1px solid var(--border)', backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
          {migrations.map(m => {
            const open = expanded.has(m.id)
            return (
              <div key={m.id}>
                <div className="flex items-center gap-3 px-4 py-3">
                  <button onClick={() => setExpanded(prev => {
                    const n = new Set(prev); n.has(m.id) ? n.delete(m.id) : n.add(m.id); return n
                  })}>
                    {open
                      ? <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />
                      : <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />}
                  </button>
                  <span className="text-sm font-mono font-medium flex-1 truncate" style={{ color: 'var(--text)' }}>
                    {m.name}
                  </span>
                  <StatusBadge status={m.status} />
                  {m.applied_at && (
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {new Date(m.applied_at).toLocaleDateString()}
                    </span>
                  )}
                  <div className="flex items-center gap-1">
                    {m.status === 'pending' && (
                      <button onClick={() => handleApply(m.id)} disabled={applying === m.id}
                        title="Apply" className="p-1.5 rounded-lg" style={{ color: '#22c55e' }}>
                        {applying === m.id ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                      </button>
                    )}
                    {m.status === 'applied' && (
                      <button onClick={() => handleRollback(m.id)} disabled={rollingBack === m.id}
                        title="Rollback" className="p-1.5 rounded-lg" style={{ color: '#f59e0b' }}>
                        {rollingBack === m.id ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                      </button>
                    )}
                    {(m.status === 'pending' || m.status === 'rolled_back' || m.status === 'failed') && (
                      <button onClick={() => handleDelete(m.id)} disabled={deleting === m.id}
                        className="p-1.5 rounded-lg" style={{ color: 'var(--text-muted)' }}
                        onMouseEnter={e => { e.currentTarget.style.color = 'var(--danger)' }}
                        onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}>
                        {deleting === m.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                      </button>
                    )}
                  </div>
                </div>
                {open && (
                  <div className="px-10 pb-3" style={{ backgroundColor: 'var(--bg)' }}>
                    {m.error && (
                      <p className="text-xs mb-2 px-3 py-2 rounded-lg"
                        style={{ color: 'var(--danger)', backgroundColor: 'color-mix(in srgb, var(--danger) 10%, transparent)' }}>
                        {m.error}
                      </p>
                    )}
                    <pre className="text-xs font-mono p-3 rounded-lg overflow-x-auto"
                      style={{ backgroundColor: '#0f0f0f', color: '#e5e5e5' }}>
                      {m.sql}
                    </pre>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {showCreate && (
        <Modal isOpen={showCreate} title="New migration" onClose={() => setShowCreate(false)}>
          <div className="space-y-3">
            <div>
              <label className="label">Name</label>
              <input className="input-field" placeholder="e.g. add_profile_table"
                value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label className="label">SQL</label>
              <textarea className="input-field font-mono resize-y" rows={8}
                placeholder="CREATE TABLE ..."
                value={form.sql} onChange={e => setForm(f => ({ ...f, sql: e.target.value }))} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowCreate(false)} className="btn-secondary">Cancel</button>
              <button onClick={handleCreate}
                disabled={creating || !form.name.trim() || !form.sql.trim()}
                className="btn-primary">
                {creating ? <Loader2 size={14} className="animate-spin" /> : null}
                Create
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
