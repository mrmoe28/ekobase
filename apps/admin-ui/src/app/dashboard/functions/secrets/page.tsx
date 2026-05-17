'use client'

import { useEffect, useState } from 'react'
import { Plus, Trash2, Eye, EyeOff, Search, Loader2, BookOpen } from 'lucide-react'
import Toast, { type ToastType } from '@/components/Toast'
import { listSecrets, upsertSecrets, deleteSecret, type FunctionSecret } from '@/lib/api'

interface ToastState { message: string; type: ToastType; id: number }

const DEFAULT_SECRETS = [
  { name: 'SUPABASE_URL', description: 'The API gateway URL for your project.' },
  { name: 'SUPABASE_ANON_KEY', description: 'The anon key for your project. Safe to use in browser.' },
  { name: 'SUPABASE_SERVICE_ROLE_KEY', description: 'The service role key. Has full DB access. Keep secret.' },
  { name: 'SUPABASE_DB_URL', description: 'The direct Postgres connection string.' },
]

interface SecretRow { name: string; value: string; showValue: boolean }

export default function SecretsPage() {
  const [secrets, setSecrets] = useState<FunctionSecret[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)

  // Form rows
  const [rows, setRows] = useState<SecretRow[]>([{ name: '', value: '', showValue: false }])

  const showToast = (message: string, type: ToastType) =>
    setToast({ message, type, id: Date.now() })

  const load = async () => {
    setLoading(true)
    try {
      setSecrets(await listSecrets())
    } catch {
      showToast('Failed to load secrets', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleSave = async () => {
    const valid = rows.filter(r => r.name.trim())
    if (valid.length === 0) return
    setSaving(true)
    try {
      await upsertSecrets(valid.map(r => ({ name: r.name.trim(), value: r.value })))
      setRows([{ name: '', value: '', showValue: false }])
      showToast(`${valid.length} secret${valid.length > 1 ? 's' : ''} saved`, 'success')
      await load()
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to save secrets', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (name: string) => {
    if (!confirm(`Delete secret "${name}"?`)) return
    setDeleting(name)
    try {
      await deleteSecret(name)
      setSecrets(prev => prev.filter(s => s.name !== name))
      showToast('Secret deleted', 'success')
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to delete secret', 'error')
    } finally {
      setDeleting(null)
    }
  }

  const updateRow = (i: number, field: 'name' | 'value', val: string) =>
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: val } : r))

  const toggleShow = (i: number) =>
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, showValue: !r.showValue } : r))

  const addRow = () => setRows(prev => [...prev, { name: '', value: '', showValue: false }])
  const removeRow = (i: number) => setRows(prev => prev.filter((_, idx) => idx !== i))

  const filtered = secrets.filter(s => s.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="max-w-5xl space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold mb-1" style={{ color: 'var(--text)' }}>Edge Function Secrets</h1>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Manage encrypted values for your functions</p>
      </div>

      {/* Add / Replace form */}
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
        <div
          className="px-5 py-3 border-b"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
        >
          <p className="text-xs font-mono font-semibold tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>
            Add or replace secrets
          </p>
        </div>
        <div className="p-5 space-y-3" style={{ backgroundColor: 'var(--surface)' }}>
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                placeholder="e.g. CLIENT_KEY"
                value={row.name}
                onChange={e => updateRow(i, 'name', e.target.value)}
                className="input-field flex-1 font-mono text-sm"
                style={{ textTransform: 'uppercase' }}
              />
              <div className="relative flex-1">
                <input
                  type={row.showValue ? 'text' : 'password'}
                  placeholder="Value"
                  value={row.value}
                  onChange={e => updateRow(i, 'value', e.target.value)}
                  className="input-field w-full pr-8 text-sm"
                />
                <button
                  type="button"
                  onClick={() => toggleShow(i)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {row.showValue ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              {rows.length > 1 && (
                <button
                  onClick={() => removeRow(i)}
                  className="p-1.5 rounded-lg transition-colors"
                  style={{ color: 'var(--text-muted)' }}
                  onMouseEnter={e => { e.currentTarget.style.color = 'var(--danger)' }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}

          <div className="flex items-center justify-between pt-1">
            <button
              onClick={addRow}
              className="flex items-center gap-1.5 text-sm transition-colors duration-150"
              style={{ color: 'var(--text-muted)' }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}
            >
              <Plus size={14} /> Add another
            </button>
            <button
              onClick={handleSave}
              disabled={saving || rows.every(r => !r.name.trim())}
              className="btn-primary"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>

      {/* Custom secrets */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--text)' }}>Custom secrets</h2>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Secrets you have defined for this project</p>
          </div>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Search for a secret"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-sm rounded-lg outline-none"
              style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', width: '200px' }}
            />
          </div>
        </div>

        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                  Name
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                  <div className="flex items-center gap-2">
                    Digest
                    <span className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ backgroundColor: 'color-mix(in srgb, var(--border) 80%, transparent)', color: 'var(--text-muted)', fontSize: '10px' }}>SHA256</span>
                  </div>
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Updated</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                    <Loader2 size={18} className="animate-spin mx-auto" />
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center" style={{ backgroundColor: 'var(--surface)' }}>
                    <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>No custom secrets created</p>
                    <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>This project has no custom secrets yet.</p>
                  </td>
                </tr>
              ) : filtered.map(s => (
                <tr key={s.name} style={{ borderTop: '1px solid var(--border)', backgroundColor: 'var(--surface)' }}>
                  <td className="px-4 py-3 font-mono text-sm" style={{ color: 'var(--text)' }}>{s.name}</td>
                  <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{s.digest}…</td>
                  <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-muted)' }}>
                    {new Date(s.updated_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleDelete(s.name)}
                      disabled={deleting === s.name}
                      className="p-1.5 rounded-lg transition-colors"
                      style={{ color: 'var(--text-muted)' }}
                      onMouseEnter={e => { e.currentTarget.style.color = 'var(--danger)' }}
                      onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}
                    >
                      {deleting === s.name ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Default secrets */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--text)' }}>Default secrets</h2>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Reserved secrets available in every project</p>
          </div>
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors duration-150"
            style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}
          >
            <BookOpen size={13} /> Docs
          </button>
        </div>

        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Name</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Description</th>
              </tr>
            </thead>
            <tbody>
              {DEFAULT_SECRETS.map((s, i) => (
                <tr key={s.name} style={{ borderTop: i > 0 ? '1px solid var(--border)' : 'none', backgroundColor: 'var(--surface)' }}>
                  <td className="px-4 py-3 font-mono text-sm font-medium" style={{ color: 'var(--text)' }}>{s.name}</td>
                  <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-muted)' }}>{s.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {toast && <Toast key={toast.id} message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
    </div>
  )
}
