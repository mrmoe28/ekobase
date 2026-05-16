'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft, Copy, Check, Eye, EyeOff, Loader2,
  Plus, Trash2, Save, FolderKanban,
} from 'lucide-react'
import Toast, { type ToastType } from '@/components/Toast'
import {
  getProject, updateProject, deleteProject,
  getProjectKeys, listProjectMembers, addProjectMember, removeProjectMember,
  listUsers,
  type Project, type User,
} from '@/lib/api'

const REGIONS = [
  { value: 'us-east-1',      label: 'US East (N. Virginia)' },
  { value: 'us-west-2',      label: 'US West (Oregon)' },
  { value: 'eu-west-1',      label: 'Europe (Ireland)' },
  { value: 'eu-central-1',   label: 'Europe (Frankfurt)' },
  { value: 'ap-southeast-1', label: 'Asia Pacific (Singapore)' },
  { value: 'ap-northeast-1', label: 'Asia Pacific (Tokyo)' },
]

interface ToastState { message: string; type: ToastType; id: number }

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<ToastState | null>(null)

  const showToast = (message: string, type: ToastType) =>
    setToast({ message, type, id: Date.now() })

  useEffect(() => {
    getProject(id)
      .then(setProject)
      .catch(() => router.replace('/dashboard/projects'))
      .finally(() => setLoading(false))
  }, [id, router])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent)' }} />
      </div>
    )
  }

  if (!project) return null

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push('/dashboard/projects')}
          className="p-1.5 rounded-lg transition-colors duration-150"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}
        >
          <ArrowLeft size={18} />
        </button>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 15%, transparent)' }}>
          <FolderKanban size={16} style={{ color: 'var(--accent)' }} />
        </div>
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text)' }}>{project.name}</h1>
          <span className="text-xs font-mono px-1.5 py-0.5 rounded"
            style={{ backgroundColor: 'var(--bg)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
            {project.region}
          </span>
        </div>
      </div>

      <SettingsSection project={project} onUpdate={setProject} showToast={showToast} />
      <ApiKeysSection projectId={id} showToast={showToast} />
      <MembersSection projectId={id} showToast={showToast} />
      <DangerZone projectId={id} projectName={project.name} showToast={showToast} router={router} />

      {toast && <Toast key={toast.id} message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
    </div>
  )
}

// ── Settings ──────────────────────────────────────────────────────────────────

function SettingsSection({ project, onUpdate, showToast }: {
  project: Project
  onUpdate: (p: Project) => void
  showToast: (m: string, t: ToastType) => void
}) {
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description ?? '')
  const [region, setRegion] = useState(project.region)
  const [saving, setSaving] = useState(false)
  const [users, setUsers] = useState<User[]>([])
  const [ownerId, setOwnerId] = useState(project.owner_id ?? '')

  useEffect(() => { listUsers().then(setUsers).catch(() => {}) }, [])

  const dirty = name !== project.name || description !== (project.description ?? '') ||
    region !== project.region || ownerId !== (project.owner_id ?? '')

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try {
      const updated = await updateProject(project.id, {
        name: name.trim(),
        description: description.trim() || null,
        owner_id: ownerId || null,
        region,
      })
      onUpdate(updated)
      showToast('Project updated', 'success')
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to update', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section title="Project settings">
      <form onSubmit={handleSave} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Name</label>
            <input className="input-field" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <label className="label">Region</label>
            <select className="input-field" value={region} onChange={e => setRegion(e.target.value)}>
              {REGIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="label">Description</label>
          <textarea className="input-field resize-none" rows={2}
            value={description} onChange={e => setDescription(e.target.value)} />
        </div>
        <div>
          <label className="label">Owner</label>
          <select className="input-field" value={ownerId} onChange={e => setOwnerId(e.target.value)}>
            <option value="">— No owner —</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.email}</option>)}
          </select>
        </div>
        <div className="flex justify-end">
          <button type="submit" className="btn-primary" disabled={!dirty || saving}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </Section>
  )
}

// ── API Keys ──────────────────────────────────────────────────────────────────

function ApiKeysSection({ projectId, showToast }: {
  projectId: string
  showToast: (m: string, t: ToastType) => void
}) {
  const [keys, setKeys] = useState<{ anon_key: string; service_role_key: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})
  const [copied, setCopied] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try { setKeys(await getProjectKeys(projectId)) }
    catch { showToast('Failed to load API keys', 'error') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [projectId])

  const copy = async (key: string, label: string) => {
    await navigator.clipboard.writeText(key)
    setCopied(label)
    showToast(`${label} copied to clipboard`, 'success')
    setTimeout(() => setCopied(null), 2000)
  }

  const keyRows = keys ? [
    { label: 'Anon key', value: keys.anon_key },
    { label: 'Service role key', value: keys.service_role_key },
  ] : []

  return (
    <Section title="API keys">
      {loading ? (
        <div className="space-y-3">{[0, 1].map(i => <div key={i} className="skeleton h-12 w-full" />)}</div>
      ) : (
        <div className="space-y-3">
          {keyRows.map(({ label, value }) => (
            <div key={label}>
              <p className="label mb-1">{label}</p>
              <div className="flex items-center gap-2">
                <div className="flex-1 flex items-center rounded-xl px-3 py-2 font-mono text-xs overflow-hidden"
                  style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                  <span className="truncate">
                    {revealed[label] ? value : `${value.slice(0, 20)}${'•'.repeat(24)}`}
                  </span>
                </div>
                <button onClick={() => setRevealed(r => ({ ...r, [label]: !r[label] }))}
                  className="p-2 rounded-xl transition-colors duration-150"
                  style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }}
                  title={revealed[label] ? 'Hide' : 'Reveal'}>
                  {revealed[label] ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
                <button onClick={() => copy(value, label)}
                  className="p-2 rounded-xl transition-colors duration-150"
                  style={{ border: '1px solid var(--border)', color: copied === label ? 'var(--accent)' : 'var(--text-muted)' }}
                  title="Copy">
                  {copied === label ? <Check size={15} /> : <Copy size={15} />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

// ── Members ───────────────────────────────────────────────────────────────────

function MembersSection({ projectId, showToast }: {
  projectId: string
  showToast: (m: string, t: ToastType) => void
}) {
  const [members, setMembers] = useState<User[]>([])
  const [allUsers, setAllUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedUserId, setSelectedUserId] = useState('')
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([listProjectMembers(projectId), listUsers()])
      .then(([m, u]) => { setMembers(m); setAllUsers(u) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [projectId])

  const memberIds = new Set(members.map(m => m.id))
  const addable = allUsers.filter(u => !memberIds.has(u.id))

  const handleAdd = async () => {
    if (!selectedUserId) return
    setAdding(true)
    try {
      const user = await addProjectMember(projectId, selectedUserId)
      setMembers(prev => [...prev, user])
      setSelectedUserId('')
      showToast('Member added', 'success')
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to add member', 'error')
    } finally {
      setAdding(false)
    }
  }

  const handleRemove = async (userId: string) => {
    setRemoving(userId)
    try {
      await removeProjectMember(projectId, userId)
      setMembers(prev => prev.filter(m => m.id !== userId))
      showToast('Member removed', 'success')
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to remove member', 'error')
    } finally {
      setRemoving(null)
    }
  }

  return (
    <Section title="Members">
      {/* Add member */}
      <div className="flex gap-2 mb-4">
        <select className="input-field flex-1" value={selectedUserId}
          onChange={e => setSelectedUserId(e.target.value)} disabled={adding}>
          <option value="">Add a user…</option>
          {addable.map(u => <option key={u.id} value={u.id}>{u.email}</option>)}
        </select>
        <button onClick={handleAdd} disabled={!selectedUserId || adding} className="btn-primary px-3">
          {adding ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
        </button>
      </div>

      {/* Member list */}
      {loading ? (
        <div className="space-y-2">{[0, 1].map(i => <div key={i} className="skeleton h-10 w-full" />)}</div>
      ) : members.length === 0 ? (
        <p className="text-sm text-center py-4" style={{ color: 'var(--text-muted)' }}>No members yet</p>
      ) : (
        <div className="space-y-1">
          {members.map(member => (
            <div key={member.id} className="flex items-center justify-between px-3 py-2 rounded-xl"
              style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}>
              <span className="text-sm" style={{ color: 'var(--text)' }}>{member.email}</span>
              <button onClick={() => handleRemove(member.id)} disabled={removing === member.id}
                className="p-1.5 rounded-lg transition-colors duration-150"
                style={{ color: 'var(--text-muted)' }}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--danger)' }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}>
                {removing === member.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              </button>
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

// ── Danger Zone ───────────────────────────────────────────────────────────────

function DangerZone({ projectId, projectName, showToast, router }: {
  projectId: string
  projectName: string
  showToast: (m: string, t: ToastType) => void
  router: ReturnType<typeof useRouter>
}) {
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    if (!confirm(`Delete "${projectName}"? This cannot be undone.`)) return
    setDeleting(true)
    try {
      await deleteProject(projectId)
      showToast('Project deleted', 'success')
      setTimeout(() => router.replace('/dashboard/projects'), 800)
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to delete', 'error')
      setDeleting(false)
    }
  }

  return (
    <div className="rounded-2xl p-5"
      style={{ border: '1px solid color-mix(in srgb, var(--danger) 35%, transparent)' }}>
      <h2 className="text-sm font-semibold mb-1" style={{ color: 'var(--danger)' }}>Danger zone</h2>
      <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
        Permanently delete this project and all associated data. This action cannot be undone.
      </p>
      <button onClick={handleDelete} disabled={deleting}
        className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors duration-150"
        style={{ backgroundColor: 'color-mix(in srgb, var(--danger) 12%, transparent)', color: 'var(--danger)', border: '1px solid color-mix(in srgb, var(--danger) 35%, transparent)' }}>
        {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
        {deleting ? 'Deleting…' : 'Delete project'}
      </button>
    </div>
  )
}

// ── Shared ────────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-5" style={{ border: '1px solid var(--border)' }}>
      <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--text)' }}>{title}</h2>
      {children}
    </div>
  )
}
