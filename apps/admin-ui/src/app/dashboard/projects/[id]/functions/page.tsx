'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Code2, Loader2, Plus, Rocket, Trash2, Zap } from 'lucide-react'
import {
  createEdgeFunction,
  createEdgeFunctionDeployment,
  deleteEdgeFunction,
  listEdgeFunctionDeployments,
  listEdgeFunctions,
  updateEdgeFunction,
  type EdgeFunction,
  type EdgeFunctionDeployment,
  type EdgeFunctionStatus,
} from '@/lib/api'
import Toast, { type ToastType } from '@/components/Toast'

interface ToastState { message: string; type: ToastType; id: number }

const STARTER_SOURCE = `export default async function handler(req: Request) {
  return Response.json({ ok: true })
}
`

function statusColor(status: EdgeFunctionStatus) {
  if (status === 'deployed') return 'var(--accent)'
  if (status === 'failed') return 'var(--danger)'
  if (status === 'disabled') return 'var(--text-muted)'
  return 'var(--warning, #d97706)'
}

export default function ProjectFunctionsPage() {
  const { id } = useParams<{ id: string }>()

  const [functions, setFunctions] = useState<EdgeFunction[]>([])
  const [deployments, setDeployments] = useState<Record<string, EdgeFunctionDeployment[]>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deploying, setDeploying] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [form, setForm] = useState({ name: '', slug: '', entrypoint: 'index.ts', verify_jwt: true })
  const [source, setSource] = useState(STARTER_SOURCE)

  const showToast = (message: string, type: ToastType) =>
    setToast({ message, type, id: Date.now() })

  const selected = functions.find(fn => fn.id === selectedId) ?? null

  const load = async () => {
    setLoading(true)
    try {
      const next = await listEdgeFunctions(id)
      setFunctions(next)
      setSelectedId(current => current ?? next[0]?.id ?? null)
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to load functions', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [id])

  useEffect(() => {
    if (!selectedId || deployments[selectedId]) return
    listEdgeFunctionDeployments(id, selectedId)
      .then(rows => setDeployments(prev => ({ ...prev, [selectedId]: rows })))
      .catch(() => showToast('Failed to load deployments', 'error'))
  }, [deployments, id, selectedId])

  const handleCreate = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      const fn = await createEdgeFunction(id, {
        name: form.name,
        slug: form.slug || undefined,
        entrypoint: form.entrypoint || 'index.ts',
        verify_jwt: form.verify_jwt,
      })
      setFunctions(prev => [fn, ...prev])
      setSelectedId(fn.id)
      setForm({ name: '', slug: '', entrypoint: 'index.ts', verify_jwt: true })
      showToast('Function created', 'success')
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to create function', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleStatus = async (fn: EdgeFunction, status: EdgeFunctionStatus) => {
    try {
      const updated = await updateEdgeFunction(id, fn.id, { status })
      setFunctions(prev => prev.map(item => item.id === fn.id ? { ...item, ...updated } : item))
      showToast('Function updated', 'success')
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to update function', 'error')
    }
  }

  const handleDeploy = async (fn: EdgeFunction) => {
    setDeploying(fn.id)
    try {
      const deployment = await createEdgeFunctionDeployment(id, fn.id, { source, status: 'deployed' })
      setDeployments(prev => ({ ...prev, [fn.id]: [deployment, ...(prev[fn.id] ?? [])] }))
      setFunctions(prev => prev.map(item => item.id === fn.id
        ? { ...item, status: 'deployed', latest_version: deployment.version, last_deployed_at: deployment.created_at }
        : item))
      showToast(`Deployed ${fn.slug}`, 'success')
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to deploy function', 'error')
    } finally {
      setDeploying(null)
    }
  }

  const handleDelete = async (fn: EdgeFunction) => {
    if (!confirm(`Delete function "${fn.name}"?`)) return
    setDeleting(fn.id)
    try {
      await deleteEdgeFunction(id, fn.id)
      setFunctions(prev => prev.filter(item => item.id !== fn.id))
      setSelectedId(current => current === fn.id ? null : current)
      showToast('Function deleted', 'success')
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to delete function', 'error')
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 15%, transparent)' }}>
            <Zap size={16} style={{ color: 'var(--accent)' }} />
          </div>
          <div>
            <h1 className="text-xl font-semibold" style={{ color: 'var(--text)' }}>Edge Functions</h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Create, deploy, disable, and inspect project-scoped functions.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
        <div className="space-y-5">
          <div className="card p-5" style={{ border: '1px solid var(--border)' }}>
            <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--text)' }}>New function</h2>
            <div className="space-y-3">
              <input
                className="input-field w-full"
                placeholder="Function name"
                value={form.name}
                onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
              />
              <input
                className="input-field w-full font-mono text-sm"
                placeholder="slug defaults from name"
                value={form.slug}
                onChange={e => setForm(prev => ({ ...prev, slug: e.target.value }))}
              />
              <input
                className="input-field w-full font-mono text-sm"
                placeholder="index.ts"
                value={form.entrypoint}
                onChange={e => setForm(prev => ({ ...prev, entrypoint: e.target.value }))}
              />
              <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text)' }}>
                <input
                  type="checkbox"
                  checked={form.verify_jwt}
                  onChange={e => setForm(prev => ({ ...prev, verify_jwt: e.target.checked }))}
                />
                Verify JWT
              </label>
              <button
                onClick={handleCreate}
                disabled={saving || !form.name.trim()}
                className="btn-primary w-full justify-center"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                Create function
              </button>
            </div>
          </div>

          <div className="card overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
              <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                Functions
              </h2>
            </div>
            {loading ? (
              <div className="p-6 flex justify-center">
                <Loader2 size={18} className="animate-spin" style={{ color: 'var(--accent)' }} />
              </div>
            ) : functions.length === 0 ? (
              <div className="p-8 text-center">
                <Code2 size={28} className="mx-auto mb-2" style={{ color: 'var(--text-muted)' }} />
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No edge functions yet.</p>
              </div>
            ) : (
              <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {functions.map(fn => (
                  <button
                    key={fn.id}
                    onClick={() => setSelectedId(fn.id)}
                    className="w-full text-left px-4 py-3 transition-colors"
                    style={{
                      backgroundColor: fn.id === selectedId ? 'color-mix(in srgb, var(--border) 55%, transparent)' : 'transparent',
                    }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium truncate" style={{ color: 'var(--text)' }}>{fn.name}</span>
                      <span className="text-[11px] font-medium" style={{ color: statusColor(fn.status) }}>{fn.status}</span>
                    </div>
                    <p className="text-xs font-mono truncate mt-1" style={{ color: 'var(--text-muted)' }}>{fn.slug}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="card min-h-[520px]" style={{ border: '1px solid var(--border)' }}>
          {!selected ? (
            <div className="h-full min-h-[520px] flex items-center justify-center text-center p-8">
              <div>
                <Zap size={32} className="mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Select a function to manage deployments.</p>
              </div>
            </div>
          ) : (
            <div className="p-5 space-y-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>{selected.name}</h2>
                  <p className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{selected.slug} / {selected.entrypoint}</p>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    className="input-field text-sm"
                    value={selected.status}
                    onChange={e => handleStatus(selected, e.target.value as EdgeFunctionStatus)}
                  >
                    <option value="draft">draft</option>
                    <option value="deployed">deployed</option>
                    <option value="failed">failed</option>
                    <option value="disabled">disabled</option>
                  </select>
                  <button
                    onClick={() => handleDelete(selected)}
                    disabled={deleting === selected.id}
                    className="p-2 rounded-lg transition-colors"
                    style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}
                    aria-label="Delete function"
                  >
                    {deleting === selected.id ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                  </button>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Deployment source</h3>
                  <button
                    onClick={() => handleDeploy(selected)}
                    disabled={deploying === selected.id}
                    className="btn-primary"
                  >
                    {deploying === selected.id ? <Loader2 size={14} className="animate-spin" /> : <Rocket size={14} />}
                    Deploy
                  </button>
                </div>
                <textarea
                  className="input-field w-full font-mono text-xs leading-5 min-h-[220px]"
                  value={source}
                  onChange={e => setSource(e.target.value)}
                  spellCheck={false}
                />
              </div>

              <div>
                <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text)' }}>Deployments</h3>
                <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                  {(deployments[selected.id] ?? []).length === 0 ? (
                    <div className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                      No deployments recorded.
                    </div>
                  ) : (
                    (deployments[selected.id] ?? []).map(deployment => (
                      <div key={deployment.id} className="flex items-center justify-between px-4 py-3 border-b last:border-b-0"
                        style={{ borderColor: 'var(--border)' }}>
                        <div>
                          <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>Version {deployment.version}</p>
                          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            {new Date(deployment.created_at).toLocaleString()}
                          </p>
                        </div>
                        <span className="text-xs font-medium" style={{ color: deployment.status === 'failed' ? 'var(--danger)' : 'var(--accent)' }}>
                          {deployment.status}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {toast && (
        <Toast key={toast.id} message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />
      )}
    </div>
  )
}
