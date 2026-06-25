'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import {
  Plug, Github, Webhook, Plus, Trash2, Loader2,
  ToggleLeft, ToggleRight, Send, Check, ExternalLink,
} from 'lucide-react'
import {
  listWebhooks, createWebhook, updateWebhook, deleteWebhook, testWebhook,
  getGithubLink, linkGithub, unlinkGithub,
  type Webhook as WebhookType, type GithubLink,
} from '@/lib/api'
import Modal from '@/components/Modal'
import Toast, { type ToastType } from '@/components/Toast'

const EVENTS = ['INSERT', 'UPDATE', 'DELETE']

interface ToastState { message: string; type: ToastType; id: number }

export default function ProjectIntegrationsPage() {
  const { id } = useParams<{ id: string }>()
  const [tab, setTab] = useState<'webhooks' | 'github'>('webhooks')
  const [toast, setToast] = useState<ToastState | null>(null)
  const showToast = (message: string, type: ToastType) =>
    setToast({ message, type, id: Date.now() })

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 15%, transparent)' }}>
          <Plug size={16} style={{ color: 'var(--accent)' }} />
        </div>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--text)' }}>Integrations</h1>
      </div>

      <div className="flex gap-1 p-1 rounded-xl w-fit"
        style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
        {(['webhooks', 'github'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className="px-4 py-1.5 rounded-lg text-sm font-medium capitalize transition-all"
            style={{
              backgroundColor: tab === t ? 'var(--bg)' : 'transparent',
              color: tab === t ? 'var(--text)' : 'var(--text-muted)',
              boxShadow: tab === t ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
            }}>
            {t === 'webhooks' ? 'Webhooks' : 'GitHub'}
          </button>
        ))}
      </div>

      {tab === 'webhooks'
        ? <WebhooksTab projectId={id} showToast={showToast} />
        : <GithubTab projectId={id} showToast={showToast} />}

      {toast && <Toast key={toast.id} message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
    </div>
  )
}

function WebhooksTab({ projectId, showToast }: { projectId: string; showToast: (m: string, t: ToastType) => void }) {
  const [webhooks, setWebhooks] = useState<WebhookType[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const [toggling, setToggling] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', table_name: '', url: '', events: [] as string[], headers: '' })
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    listWebhooks(projectId)
      .then(setWebhooks)
      .catch(() => showToast('Failed to load webhooks', 'error'))
      .finally(() => setLoading(false))
  }, [projectId])

  const handleCreate = async () => {
    if (!form.name.trim() || !form.table_name.trim() || !form.url.trim() || form.events.length === 0) return
    let headers: Record<string, string> = {}
    if (form.headers.trim()) {
      try { headers = JSON.parse(form.headers) } catch { showToast('Headers must be valid JSON', 'error'); return }
    }
    setCreating(true)
    try {
      const wh = await createWebhook(projectId, {
        name: form.name.trim(), table_name: form.table_name.trim(),
        url: form.url.trim(), events: form.events, headers,
      })
      setWebhooks(prev => [...prev, wh])
      setShowCreate(false)
      setForm({ name: '', table_name: '', url: '', events: [], headers: '' })
      showToast('Webhook created', 'success')
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to create', 'error')
    } finally {
      setCreating(false)
    }
  }

  const handleToggle = async (wh: WebhookType) => {
    setToggling(wh.id)
    try {
      const updated = await updateWebhook(projectId, wh.id, { enabled: !wh.enabled })
      setWebhooks(prev => prev.map(w => w.id === wh.id ? updated : w))
    } catch { showToast('Failed to update', 'error') }
    finally { setToggling(null) }
  }

  const handleTest = async (wh: WebhookType) => {
    setTesting(wh.id)
    try {
      const res = await testWebhook(projectId, wh.id)
      showToast(`Test sent — HTTP ${res.status}`, res.ok ? 'success' : 'error')
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Test failed', 'error')
    } finally { setTesting(null) }
  }

  const handleDelete = async (whId: string) => {
    setDeleting(whId)
    try {
      await deleteWebhook(projectId, whId)
      setWebhooks(prev => prev.filter(w => w.id !== whId))
      showToast('Webhook deleted', 'success')
    } catch { showToast('Failed to delete', 'error') }
    finally { setDeleting(null) }
  }

  const toggleEvent = (e: string) =>
    setForm(f => ({ ...f, events: f.events.includes(e) ? f.events.filter(x => x !== e) : [...f.events, e] }))

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Fire HTTP POST requests when database rows change.
        </p>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium"
          style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 15%, transparent)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)' }}>
          <Plus size={13} /> New webhook
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 size={22} className="animate-spin" style={{ color: 'var(--accent)' }} /></div>
      ) : webhooks.length === 0 ? (
        <div className="card p-8 text-center" style={{ border: '1px solid var(--border)' }}>
          <Webhook size={32} className="mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No webhooks yet.</p>
        </div>
      ) : (
        <div className="rounded-xl divide-y" style={{ border: '1px solid var(--border)', backgroundColor: 'var(--surface)' }}>
          {webhooks.map(wh => (
            <div key={wh.id} className="px-4 py-3 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: 'var(--text)' }}>{wh.name}</p>
                <p className="text-xs font-mono truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>{wh.url}</p>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <span className="text-xs px-1.5 py-0.5 rounded font-mono"
                    style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 10%, transparent)', color: 'var(--accent)' }}>
                    {wh.table_name}
                  </span>
                  {wh.events.map(ev => (
                    <span key={ev} className="text-xs px-1.5 py-0.5 rounded font-mono"
                      style={{ backgroundColor: 'color-mix(in srgb, var(--border) 60%, transparent)', color: 'var(--text-muted)' }}>
                      {ev}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => handleToggle(wh)} disabled={toggling === wh.id} title={wh.enabled ? 'Disable' : 'Enable'}
                  style={{ color: wh.enabled ? 'var(--accent)' : 'var(--text-muted)' }}>
                  {toggling === wh.id
                    ? <Loader2 size={18} className="animate-spin" />
                    : wh.enabled ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                </button>
                <button onClick={() => handleTest(wh)} disabled={testing === wh.id} title="Send test"
                  className="p-1.5 rounded-lg" style={{ color: 'var(--text-muted)' }}
                  onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent)' }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}>
                  {testing === wh.id ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                </button>
                <button onClick={() => handleDelete(wh.id)} disabled={deleting === wh.id}
                  className="p-1.5 rounded-lg" style={{ color: 'var(--text-muted)' }}
                  onMouseEnter={e => { e.currentTarget.style.color = 'var(--danger)' }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}>
                  {deleting === wh.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <Modal isOpen={showCreate} title="New webhook" onClose={() => setShowCreate(false)}>
          <div className="space-y-3">
            <div>
              <label className="label">Name</label>
              <input className="input-field" placeholder="e.g. Notify on new user"
                value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label className="label">Table</label>
              <input className="input-field font-mono" placeholder="e.g. profiles"
                value={form.table_name} onChange={e => setForm(f => ({ ...f, table_name: e.target.value }))} />
            </div>
            <div>
              <label className="label">Events</label>
              <div className="flex gap-2">
                {EVENTS.map(ev => (
                  <button key={ev} onClick={() => toggleEvent(ev)} type="button"
                    className="px-3 py-1 rounded-lg text-xs font-mono font-medium transition-all"
                    style={{
                      backgroundColor: form.events.includes(ev) ? 'color-mix(in srgb, var(--accent) 20%, transparent)' : 'var(--bg)',
                      color: form.events.includes(ev) ? 'var(--accent)' : 'var(--text-muted)',
                      border: `1px solid ${form.events.includes(ev) ? 'color-mix(in srgb, var(--accent) 40%, transparent)' : 'var(--border)'}`,
                    }}>
                    {form.events.includes(ev) && <Check size={10} className="inline mr-1" />}{ev}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="label">URL</label>
              <input className="input-field font-mono" placeholder="https://example.com/webhook"
                value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} />
            </div>
            <div>
              <label className="label">Headers (JSON, optional)</label>
              <textarea className="input-field font-mono resize-none" rows={3}
                placeholder={'{"Authorization": "Bearer ..."}'}
                value={form.headers} onChange={e => setForm(f => ({ ...f, headers: e.target.value }))} />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setShowCreate(false)} className="btn-secondary">Cancel</button>
              <button onClick={handleCreate}
                disabled={creating || !form.name.trim() || !form.table_name.trim() || !form.url.trim() || form.events.length === 0}
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

function GithubTab({ projectId, showToast }: { projectId: string; showToast: (m: string, t: ToastType) => void }) {
  const [link, setLink] = useState<GithubLink | null>(null)
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ repo_url: '', branch: 'main' })
  const [saving, setSaving] = useState(false)
  const [unlinking, setUnlinking] = useState(false)

  useEffect(() => {
    getGithubLink(projectId)
      .then(setLink)
      .catch(() => setLink(null))
      .finally(() => setLoading(false))
  }, [projectId])

  const handleLink = async () => {
    if (!form.repo_url.trim()) return
    setSaving(true)
    try {
      const result = await linkGithub(projectId, { repo_url: form.repo_url.trim(), branch: form.branch.trim() || 'main' })
      setLink(result)
      showToast('Repository linked', 'success')
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to link', 'error')
    } finally { setSaving(false) }
  }

  const handleUnlink = async () => {
    if (!confirm('Disconnect this repository?')) return
    setUnlinking(true)
    try {
      await unlinkGithub(projectId)
      setLink(null)
      setForm({ repo_url: '', branch: 'main' })
      showToast('Repository disconnected', 'success')
    } catch { showToast('Failed to disconnect', 'error') }
    finally { setUnlinking(false) }
  }

  if (loading) return (
    <div className="flex justify-center py-10">
      <Loader2 size={22} className="animate-spin" style={{ color: 'var(--accent)' }} />
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="card p-5" style={{ border: '1px solid var(--border)' }}>
        <div className="flex items-center gap-3 mb-4">
          <Github size={20} style={{ color: 'var(--text)' }} />
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>GitHub Repository</h2>
        </div>

        {link ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between px-4 py-3 rounded-xl"
              style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}>
              <div>
                <p className="text-sm font-medium font-mono" style={{ color: 'var(--text)' }}>{link.repo_url}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  Branch: <span className="font-mono">{link.branch}</span>
                  {' · '}Connected {new Date(link.connected_at).toLocaleDateString()}
                </p>
              </div>
              <a href={link.repo_url} target="_blank" rel="noopener noreferrer"
                className="p-1.5 rounded-lg" style={{ color: 'var(--text-muted)' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--accent)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)' }}>
                <ExternalLink size={14} />
              </a>
            </div>
            <div className="flex justify-end">
              <button onClick={handleUnlink} disabled={unlinking}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium"
                style={{
                  backgroundColor: 'color-mix(in srgb, var(--danger) 12%, transparent)',
                  color: 'var(--danger)',
                  border: '1px solid color-mix(in srgb, var(--danger) 35%, transparent)',
                }}>
                {unlinking ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                Disconnect
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Link a GitHub repository to this project for reference.
            </p>
            <div>
              <label className="label">Repository URL</label>
              <input className="input-field font-mono" placeholder="https://github.com/org/repo"
                value={form.repo_url} onChange={e => setForm(f => ({ ...f, repo_url: e.target.value }))} />
            </div>
            <div>
              <label className="label">Branch</label>
              <input className="input-field font-mono" placeholder="main"
                value={form.branch} onChange={e => setForm(f => ({ ...f, branch: e.target.value }))} />
            </div>
            <div className="flex justify-end">
              <button onClick={handleLink} disabled={saving || !form.repo_url.trim()} className="btn-primary">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Github size={14} />}
                Connect repository
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
