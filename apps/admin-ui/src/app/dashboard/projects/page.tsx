'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { Plus, Trash2, Loader2, RefreshCw, FolderKanban } from 'lucide-react'
import Modal from '@/components/Modal'
import Toast, { type ToastType } from '@/components/Toast'
import {
  listProjects,
  listUsers,
  createProject,
  deleteProject,
  type Project,
  type User,
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

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  // Form state
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [region, setRegion] = useState('us-east-1')
  const [creating, setCreating] = useState(false)
  const [formError, setFormError] = useState('')

  const showToast = (message: string, type: ToastType) =>
    setToast({ message, type, id: Date.now() })

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [projectData, userData] = await Promise.all([listProjects(), listUsers()])
      setProjects(projectData)
      setUsers(userData)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load projects')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const openModal = () => {
    setName(''); setDescription(''); setOwnerId(''); setRegion('us-east-1'); setFormError('')
    setShowModal(true)
  }

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault()
    setFormError('')
    if (!name.trim()) { setFormError('Project name is required.'); return }
    setCreating(true)
    try {
      const project = await createProject({
        name: name.trim(),
        description: description.trim() || undefined,
        owner_id: ownerId || undefined,
        region,
      })
      setProjects(prev => [project, ...prev])
      setShowModal(false)
      showToast('Project created', 'success')
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to create project')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (project: Project) => {
    if (!confirm(`Delete project "${project.name}"? This cannot be undone.`)) return
    setDeleting(project.id)
    try {
      await deleteProject(project.id)
      setProjects(prev => prev.filter(p => p.id !== project.id))
      showToast('Project deleted', 'success')
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to delete project', 'error')
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--text)' }}>Projects</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {loading ? 'Loading…' : `${projects.length} project${projects.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="p-2 rounded-xl transition-colors duration-150"
            style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}
            title="Refresh"
          >
            <RefreshCw size={16} />
          </button>
          <button onClick={openModal} className="btn-primary">
            <Plus size={16} />
            New project
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl px-4 py-3 text-sm"
          style={{ backgroundColor: 'color-mix(in srgb, var(--danger) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      {/* Table */}
      <div className="card overflow-hidden" style={{ border: '1px solid var(--border)' }}>
        {loading ? (
          <div className="p-8 space-y-3">
            {[...Array(3)].map((_, i) => <div key={i} className="skeleton h-10 w-full" />)}
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <FolderKanban size={36} style={{ color: 'var(--text-muted)' }} />
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No projects yet</p>
            <button onClick={openModal} className="btn-primary">
              <Plus size={16} /> New project
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Name', 'Region', 'Owner', 'Created', ''].map(col => (
                    <th key={col} className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wide"
                      style={{ color: 'var(--text-muted)' }}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {projects.map(project => (
                  <tr
                    key={project.id}
                    className="table-row-hover transition-colors duration-100"
                    style={{ borderBottom: '1px solid var(--border)' }}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                          style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 15%, transparent)' }}>
                          <FolderKanban size={14} style={{ color: 'var(--accent)' }} />
                        </div>
                        <div>
                          <p className="font-medium" style={{ color: 'var(--text)' }}>{project.name}</p>
                          {project.description && (
                            <p className="text-xs truncate max-w-[200px]" style={{ color: 'var(--text-muted)' }}>
                              {project.description}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-1 rounded-full font-mono"
                        style={{ backgroundColor: 'var(--bg)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                        {project.region}
                      </span>
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--text-muted)' }}>
                      {project.owner_email ?? <span className="italic">—</span>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                      {formatDate(project.created_at)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleDelete(project)}
                        disabled={deleting === project.id}
                        className="p-1.5 rounded-lg transition-colors duration-150"
                        style={{ color: 'var(--text-muted)' }}
                        onMouseEnter={e => { e.currentTarget.style.color = 'var(--danger)' }}
                        onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}
                        title="Delete project"
                      >
                        {deleting === project.id
                          ? <Loader2 size={15} className="animate-spin" />
                          : <Trash2 size={15} />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="New project">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="label">Project name <span style={{ color: 'var(--danger)' }}>*</span></label>
            <input
              type="text" className="input-field" placeholder="My project"
              value={name} onChange={e => setName(e.target.value)} autoFocus
            />
          </div>
          <div>
            <label className="label">Description <span style={{ color: 'var(--text-muted)' }}>(optional)</span></label>
            <textarea
              className="input-field resize-none" rows={2} placeholder="What is this project for?"
              value={description} onChange={e => setDescription(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Owner <span style={{ color: 'var(--text-muted)' }}>(optional)</span></label>
            <select className="input-field" value={ownerId} onChange={e => setOwnerId(e.target.value)}>
              <option value="">— No owner —</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.email}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Region</label>
            <select className="input-field" value={region} onChange={e => setRegion(e.target.value)}>
              {REGIONS.map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
          {formError && <p className="text-sm" style={{ color: 'var(--danger)' }}>{formError}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setShowModal(false)}
              className="px-4 py-2 rounded-xl text-sm font-medium transition-colors duration-150"
              style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={creating}>
              {creating && <Loader2 size={14} className="animate-spin" />}
              {creating ? 'Creating…' : 'Create project'}
            </button>
          </div>
        </form>
      </Modal>

      {toast && (
        <Toast key={toast.id} message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />
      )}
    </div>
  )
}
