'use client'

import { useEffect, useState, useRef, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import {
  Plus, Trash2, Loader2, FolderKanban, MoreHorizontal,
  Search, LayoutGrid, List, ChevronDown,
} from 'lucide-react'
import Modal from '@/components/Modal'
import Toast, { type ToastType } from '@/components/Toast'
import {
  listProjects, listUsers, createProject, deleteProject,
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

const TIER_LABEL = 'FREE'

interface ToastState { message: string; type: ToastType; id: number }

function ProjectCard({
  project,
  onDelete,
  deleting,
  onClick,
}: {
  project: Project
  onDelete: (p: Project) => void
  deleting: boolean
  onClick: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div
      className="rounded-xl p-4 cursor-pointer transition-all duration-150 group relative"
      style={{
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border)',
        minHeight: '130px',
      }}
      onClick={onClick}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--text-muted)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)' }}
    >
      {/* Top row */}
      <div className="flex items-start justify-between mb-1">
        <p className="font-medium text-sm leading-snug" style={{ color: 'var(--text)' }}>
          {project.name}
        </p>
        <div ref={menuRef} className="relative shrink-0 ml-2">
          <button
            className="p-1 rounded-md transition-colors duration-150 opacity-0 group-hover:opacity-100"
            style={{ color: 'var(--text-muted)' }}
            onClick={e => { e.stopPropagation(); setMenuOpen(o => !o) }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'color-mix(in srgb, var(--border) 80%, transparent)' }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent' }}
          >
            <MoreHorizontal size={16} />
          </button>
          {menuOpen && (
            <div
              className="absolute right-0 top-full mt-1 z-10 rounded-lg py-1 min-w-[140px]"
              style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)' }}
            >
              <button
                className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors duration-100"
                style={{ color: 'var(--danger)' }}
                onClick={e => { e.stopPropagation(); setMenuOpen(false); onDelete(project) }}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'color-mix(in srgb, var(--danger) 10%, transparent)' }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent' }}
                disabled={deleting}
              >
                {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                Delete project
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Region */}
      <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
        Local&nbsp;|&nbsp;{project.region}
      </p>

      {/* Tier badge */}
      <span
        className="text-xs font-mono font-medium px-2 py-0.5 rounded"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--border) 80%, transparent)',
          color: 'var(--text-muted)',
          border: '1px solid var(--border)',
          letterSpacing: '0.05em',
        }}
      >
        {TIER_LABEL}
      </span>
    </div>
  )
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const router = useRouter()

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
    setLoading(true); setError(null)
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

  const filtered = projects
    .filter(p => p.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <h1 className="text-2xl font-semibold" style={{ color: 'var(--text)' }}>Projects</h1>

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Search */}
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="Search for a project"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 pr-3 py-1.5 text-sm rounded-lg outline-none"
            style={{
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              width: '220px',
            }}
          />
        </div>

        {/* Status filter */}
        <button
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors duration-150"
          style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}
        >
          Status <ChevronDown size={13} />
        </button>

        {/* Sort */}
        <button
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors duration-150"
          style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2 4h8M2 8h5M2 12h3" strokeLinecap="round"/>
          </svg>
          Sorted by name
        </button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* View toggle */}
        <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
          <button
            onClick={() => setViewMode('grid')}
            className="p-1.5 transition-colors duration-150"
            style={{
              backgroundColor: viewMode === 'grid' ? 'var(--border)' : 'var(--surface)',
              color: viewMode === 'grid' ? 'var(--text)' : 'var(--text-muted)',
            }}
          >
            <LayoutGrid size={15} />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className="p-1.5 transition-colors duration-150"
            style={{
              backgroundColor: viewMode === 'list' ? 'var(--border)' : 'var(--surface)',
              color: viewMode === 'list' ? 'var(--text)' : 'var(--text-muted)',
            }}
          >
            <List size={15} />
          </button>
        </div>

        {/* New project */}
        <button onClick={openModal} className="btn-primary">
          <Plus size={15} />
          New project
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl px-4 py-3 text-sm"
          style={{ backgroundColor: 'color-mix(in srgb, var(--danger) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className={viewMode === 'grid' ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4' : 'space-y-3'}>
          {[...Array(6)].map((_, i) => (
            <div key={i} className="skeleton rounded-xl" style={{ height: '130px' }} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <FolderKanban size={36} style={{ color: 'var(--text-muted)' }} />
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {search ? 'No projects match your search' : 'No projects yet'}
          </p>
          {!search && (
            <button onClick={openModal} className="btn-primary">
              <Plus size={16} /> New project
            </button>
          )}
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(project => (
            <ProjectCard
              key={project.id}
              project={project}
              onDelete={handleDelete}
              deleting={deleting === project.id}
              onClick={() => router.push(`/dashboard/projects/${project.id}`)}
            />
          ))}
        </div>
      ) : (
        /* List view */
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Name', 'Region', 'Owner', ''].map(col => (
                  <th key={col} className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wide"
                    style={{ color: 'var(--text-muted)' }}>
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(project => (
                <tr
                  key={project.id}
                  className="table-row-hover transition-colors duration-100 cursor-pointer"
                  style={{ borderBottom: '1px solid var(--border)' }}
                  onClick={e => {
                    if ((e.target as HTMLElement).closest('button')) return
                    router.push(`/dashboard/projects/${project.id}`)
                  }}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                        style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 15%, transparent)' }}>
                        <FolderKanban size={14} style={{ color: 'var(--accent)' }} />
                      </div>
                      <p className="font-medium" style={{ color: 'var(--text)' }}>{project.name}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-1 rounded font-mono"
                      style={{ backgroundColor: 'var(--bg)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                      {project.region}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-muted)' }}>
                    {project.owner_email ?? <span className="italic">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleDelete(project)}
                      disabled={deleting === project.id}
                      className="p-1.5 rounded-lg transition-colors duration-150"
                      style={{ color: 'var(--text-muted)' }}
                      onMouseEnter={e => { e.currentTarget.style.color = 'var(--danger)' }}
                      onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}
                    >
                      {deleting === project.id ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="New project">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="label">Project name <span style={{ color: 'var(--danger)' }}>*</span></label>
            <input type="text" className="input-field" placeholder="My project"
              value={name} onChange={e => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="label">Description <span style={{ color: 'var(--text-muted)' }}>(optional)</span></label>
            <textarea className="input-field resize-none" rows={2} placeholder="What is this project for?"
              value={description} onChange={e => setDescription(e.target.value)} />
          </div>
          <div>
            <label className="label">Owner <span style={{ color: 'var(--text-muted)' }}>(optional)</span></label>
            <select className="input-field" value={ownerId} onChange={e => setOwnerId(e.target.value)}>
              <option value="">— No owner —</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.email}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Region</label>
            <select className="input-field" value={region} onChange={e => setRegion(e.target.value)}>
              {REGIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
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

      {toast && <Toast key={toast.id} message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
    </div>
  )
}
