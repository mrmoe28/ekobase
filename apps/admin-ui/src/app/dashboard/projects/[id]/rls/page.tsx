'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { ShieldCheck, Plus, Trash2, Loader2, ChevronDown, ChevronRight } from 'lucide-react'
import {
  getSchemaTables, listPolicies, createPolicy, deletePolicy, type RlsPolicy,
} from '@/lib/api'
import Modal from '@/components/Modal'
import Toast, { type ToastType } from '@/components/Toast'

interface ToastState { message: string; type: ToastType; id: number }
const COMMANDS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'ALL']

export default function ProjectRlsPage() {
  const { id } = useParams<{ id: string }>()
  const projectSchema = 'proj_' + id.replace(/-/g, '').slice(0, 16)

  const [tables, setTables] = useState<string[]>([])
  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const [policies, setPolicies] = useState<RlsPolicy[]>([])
  const [loading, setLoading] = useState(true)
  const [policiesLoading, setPoliciesLoading] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', command: 'SELECT', permissive: true, roles: '', using: '', with_check: '' })
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)

  const showToast = (message: string, type: ToastType) =>
    setToast({ message, type, id: Date.now() })

  useEffect(() => {
    getSchemaTables()
      .then(map => {
        const names = Object.keys(map[projectSchema] ?? {})
        setTables(names)
        if (names[0]) setSelectedTable(names[0])
      })
      .finally(() => setLoading(false))
  }, [projectSchema])

  useEffect(() => {
    if (!selectedTable) return
    setPoliciesLoading(true)
    listPolicies(projectSchema, selectedTable)
      .then(setPolicies)
      .catch(() => showToast('Failed to load policies', 'error'))
      .finally(() => setPoliciesLoading(false))
  }, [projectSchema, selectedTable])

  const handleCreate = async () => {
    if (!selectedTable || !form.name) return
    setCreating(true)
    try {
      const roles = form.roles.split(',').map(r => r.trim()).filter(Boolean)
      const policy = await createPolicy(projectSchema, selectedTable, {
        name: form.name,
        command: form.command,
        permissive: form.permissive,
        roles: roles.length ? roles : undefined,
        using: form.using || undefined,
        with_check: form.with_check || undefined,
      })
      setPolicies(prev => [...prev, policy])
      showToast('Policy created', 'success')
      setShowCreate(false)
      setForm({ name: '', command: 'SELECT', permissive: true, roles: '', using: '', with_check: '' })
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to create policy', 'error')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (policyName: string) => {
    if (!selectedTable) return
    setDeleting(policyName)
    try {
      await deletePolicy(projectSchema, selectedTable, policyName)
      setPolicies(prev => prev.filter(p => p.policyname !== policyName))
      showToast('Policy deleted', 'success')
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to delete', 'error')
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="max-w-full space-y-4">
      {toast && <Toast key={toast.id} message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}

      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 15%, transparent)' }}>
          <ShieldCheck size={16} style={{ color: 'var(--accent)' }} />
        </div>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--text)' }}>RLS Policies</h1>
        <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{projectSchema}</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 size={22} className="animate-spin" style={{ color: 'var(--accent)' }} />
        </div>
      ) : tables.length === 0 ? (
        <div className="card p-8 text-center" style={{ border: '1px solid var(--border)' }}>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No tables in this project schema yet.</p>
        </div>
      ) : (
        <div className="flex gap-4">
          <div className="w-44 shrink-0 rounded-xl overflow-hidden"
            style={{ border: '1px solid var(--border)', backgroundColor: 'var(--surface)' }}>
            <p className="px-3 py-2 text-xs font-semibold border-b"
              style={{ color: 'var(--text-muted)', borderColor: 'var(--border)' }}>Tables</p>
            {tables.map(t => (
              <button key={t} onClick={() => setSelectedTable(t)}
                className="w-full text-left px-3 py-2 text-xs font-mono truncate border-b"
                style={{
                  borderColor: 'var(--border)',
                  color: selectedTable === t ? 'var(--accent)' : 'var(--text)',
                  backgroundColor: selectedTable === t ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent',
                }}>
                {t}
              </button>
            ))}
          </div>

          <div className="flex-1 min-w-0 rounded-xl"
            style={{ border: '1px solid var(--border)', backgroundColor: 'var(--surface)' }}>
            <div className="flex items-center justify-between px-4 py-3 border-b"
              style={{ borderColor: 'var(--border)' }}>
              <span className="text-sm font-medium" style={{ color: 'var(--text)' }}>
                {selectedTable ?? '—'}{' '}
                <span style={{ color: 'var(--text-muted)' }}>({policies.length} {policies.length === 1 ? 'policy' : 'policies'})</span>
              </span>
              <button onClick={() => setShowCreate(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
                style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 15%, transparent)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)' }}>
                <Plus size={12} /> New policy
              </button>
            </div>

            {policiesLoading ? (
              <div className="flex items-center justify-center h-24">
                <Loader2 size={18} className="animate-spin" style={{ color: 'var(--accent)' }} />
              </div>
            ) : policies.length === 0 ? (
              <p className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>No RLS policies on this table</p>
            ) : (
              <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {policies.map(p => {
                  const open = expanded.has(p.policyname)
                  return (
                    <div key={p.policyname}>
                      <div className="flex items-center gap-3 px-4 py-3">
                        <button onClick={() => setExpanded(prev => {
                          const n = new Set(prev); n.has(p.policyname) ? n.delete(p.policyname) : n.add(p.policyname); return n
                        })}>
                          {open ? <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} /> : <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />}
                        </button>
                        <span className="text-sm font-mono font-medium flex-1" style={{ color: 'var(--text)' }}>{p.policyname}</span>
                        <span className="text-xs px-2 py-0.5 rounded font-mono"
                          style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 12%, transparent)', color: 'var(--accent)' }}>
                          {p.cmd}
                        </span>
                        <span className="text-xs" style={{ color: p.permissive === 'PERMISSIVE' ? '#22c55e' : '#f59e0b' }}>
                          {p.permissive}
                        </span>
                        <button onClick={() => handleDelete(p.policyname)} disabled={deleting === p.policyname}
                          className="p-1.5 rounded-lg ml-1" style={{ color: 'var(--text-muted)' }}
                          onMouseEnter={e => { e.currentTarget.style.color = 'var(--danger)' }}
                          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}>
                          {deleting === p.policyname ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                        </button>
                      </div>
                      {open && (
                        <div className="px-10 pb-3 space-y-1" style={{ backgroundColor: 'var(--bg)' }}>
                          {p.roles.length > 0 && (
                            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                              <span style={{ color: 'var(--text)' }}>Roles: </span>{p.roles.join(', ')}
                            </p>
                          )}
                          {p.qual && (
                            <p className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                              <span style={{ color: 'var(--text)' }}>USING: </span>{p.qual}
                            </p>
                          )}
                          {p.with_check && (
                            <p className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                              <span style={{ color: 'var(--text)' }}>WITH CHECK: </span>{p.with_check}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {showCreate && selectedTable && (
        <Modal isOpen={showCreate} title={`New policy on ${selectedTable}`} onClose={() => setShowCreate(false)}>
          <div className="space-y-3">
            <div>
              <label className="label">Policy name</label>
              <input className="input-field" placeholder="e.g. users_own_rows"
                value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Command</label>
                <select className="input-field" value={form.command}
                  onChange={e => setForm(f => ({ ...f, command: e.target.value }))}>
                  {COMMANDS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Type</label>
                <select className="input-field" value={form.permissive ? 'permissive' : 'restrictive'}
                  onChange={e => setForm(f => ({ ...f, permissive: e.target.value === 'permissive' }))}>
                  <option value="permissive">PERMISSIVE</option>
                  <option value="restrictive">RESTRICTIVE</option>
                </select>
              </div>
            </div>
            <div>
              <label className="label">Roles (comma-separated, blank = all)</label>
              <input className="input-field font-mono" placeholder="authenticated, anon"
                value={form.roles} onChange={e => setForm(f => ({ ...f, roles: e.target.value }))} />
            </div>
            <div>
              <label className="label">USING expression</label>
              <input className="input-field font-mono" placeholder="(auth.uid() = user_id)"
                value={form.using} onChange={e => setForm(f => ({ ...f, using: e.target.value }))} />
            </div>
            <div>
              <label className="label">WITH CHECK expression</label>
              <input className="input-field font-mono" placeholder="(auth.uid() = user_id)"
                value={form.with_check} onChange={e => setForm(f => ({ ...f, with_check: e.target.value }))} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowCreate(false)} className="btn-secondary">Cancel</button>
              <button onClick={handleCreate} disabled={creating || !form.name} className="btn-primary">
                {creating ? <Loader2 size={14} className="animate-spin" /> : null}
                Create policy
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
