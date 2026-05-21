'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  HardDrive,
  Plus,
  Trash2,
  Loader2,
  Globe,
  Lock,
  User as UserIcon,
  FolderOpen,
} from 'lucide-react'
import {
  listBuckets,
  createBucket,
  deleteBucket,
  type StorageBucket,
} from '@/lib/api'
import Modal from '@/components/Modal'
import Toast, { type ToastType } from '@/components/Toast'

type Visibility = 'private' | 'public' | 'user_scoped'

interface ToastState {
  message: string
  type: ToastType
  id: number
}

function visibilityBadge(b: StorageBucket) {
  if (b.public) {
    return { label: 'Public', Icon: Globe, color: 'var(--accent)' }
  }
  if (b.private_user_scoped) {
    return { label: 'User-scoped', Icon: UserIcon, color: 'var(--text-muted)' }
  }
  return { label: 'Private', Icon: Lock, color: 'var(--text-muted)' }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default function ProjectStoragePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  const [buckets, setBuckets] = useState<StorageBucket[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<StorageBucket | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)

  const [name, setName] = useState('')
  const [visibility, setVisibility] = useState<Visibility>('private')

  const showToast = (message: string, type: ToastType) =>
    setToast({ message, type, id: Date.now() })

  useEffect(() => {
    listBuckets(id)
      .then(setBuckets)
      .catch((err: unknown) =>
        showToast(err instanceof Error ? err.message : 'Failed to load buckets', 'error'),
      )
      .finally(() => setLoading(false))
  }, [id])

  const resetCreate = () => {
    setName('')
    setVisibility('private')
    setCreateOpen(false)
  }

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault()
    setCreating(true)
    try {
      const bucket = await createBucket(id, {
        name: name.trim(),
        public: visibility === 'public',
        private_user_scoped: visibility === 'user_scoped',
      })
      setBuckets((prev) => [bucket, ...prev])
      resetCreate()
      showToast('Bucket created', 'success')
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to create bucket', 'error')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteBucket(id, confirmDelete.name)
      setBuckets((prev) => prev.filter((b) => b.id !== confirmDelete.id))
      setConfirmDelete(null)
      showToast('Bucket deleted', 'success')
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to delete bucket', 'error')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 15%, transparent)' }}
          >
            <HardDrive size={16} style={{ color: 'var(--accent)' }} />
          </div>
          <div>
            <h1 className="text-xl font-semibold" style={{ color: 'var(--text)' }}>
              Storage
            </h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Buckets and files in this project
            </p>
          </div>
        </div>
        <button onClick={() => setCreateOpen(true)} className="btn-primary px-3 py-2 flex items-center gap-2">
          <Plus size={14} />
          New bucket
        </button>
      </div>

      <div className="card p-5" style={{ border: '1px solid var(--border)' }}>
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-14 w-full" />
            ))}
          </div>
        ) : buckets.length === 0 ? (
          <div className="text-center py-12">
            <HardDrive size={28} className="mx-auto mb-2" style={{ color: 'var(--text-muted)' }} />
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              No buckets yet. Create one to start storing files.
            </p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {buckets.map((b) => {
              const badge = visibilityBadge(b)
              const Icon = badge.Icon
              return (
                <div key={b.id} className="flex items-center justify-between py-3">
                  <button
                    onClick={() => router.push(`/dashboard/projects/${id}/storage/${encodeURIComponent(b.name)}`)}
                    className="flex items-center gap-3 flex-1 text-left rounded-lg p-2 -m-2 transition-colors"
                    style={{ color: 'var(--text)' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor =
                        'color-mix(in srgb, var(--accent) 6%, transparent)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent'
                    }}
                  >
                    <FolderOpen size={16} style={{ color: 'var(--text-muted)' }} />
                    <div>
                      <p className="text-sm font-medium">{b.name}</p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {b.file_count} {b.file_count === 1 ? 'file' : 'files'} · created {formatDate(b.created_at)}
                      </p>
                    </div>
                  </button>
                  <div className="flex items-center gap-3 shrink-0">
                    <span
                      className="text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1"
                      style={{
                        backgroundColor: 'color-mix(in srgb, var(--accent) 10%, transparent)',
                        color: badge.color,
                      }}
                    >
                      <Icon size={11} />
                      {badge.label}
                    </span>
                    <button
                      onClick={() => setConfirmDelete(b)}
                      className="p-1.5 rounded-lg transition-colors"
                      style={{ color: 'var(--text-muted)' }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = 'var(--danger)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = 'var(--text-muted)'
                      }}
                      title="Delete bucket"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <Modal isOpen={createOpen} title="New bucket" onClose={resetCreate}>
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="label mb-1 block">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input-field w-full"
              placeholder="avatars"
              pattern="[a-z0-9][a-z0-9._-]{0,62}"
              title="Lowercase letters, digits, '.', '_', '-'; 1-63 chars; must start with a letter or digit"
              required
              autoFocus
            />
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              Lowercase letters, digits, dot, underscore, dash. Must start with a letter or digit.
            </p>
          </div>
          <div>
            <label className="label mb-2 block">Visibility</label>
            <div className="space-y-2">
              {(
                [
                  { val: 'private', label: 'Private', desc: 'Only the owner can read/write. Default.' },
                  { val: 'public', label: 'Public', desc: 'Anyone can read files; only the owner can write.' },
                  { val: 'user_scoped', label: 'User-scoped', desc: "Each signed-in user gets their own folder under <user-id>/." },
                ] as { val: Visibility; label: string; desc: string }[]
              ).map((opt) => (
                <label
                  key={opt.val}
                  className="flex items-start gap-3 p-2 rounded-lg cursor-pointer"
                  style={{ border: '1px solid var(--border)' }}
                >
                  <input
                    type="radio"
                    name="visibility"
                    value={opt.val}
                    checked={visibility === opt.val}
                    onChange={() => setVisibility(opt.val)}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>
                      {opt.label}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {opt.desc}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={resetCreate} className="btn-secondary px-3 py-2" disabled={creating}>
              Cancel
            </button>
            <button type="submit" className="btn-primary px-3 py-2 flex items-center gap-2" disabled={creating || !name.trim()}>
              {creating && <Loader2 size={14} className="animate-spin" />}
              Create bucket
            </button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={confirmDelete !== null} title="Delete bucket?" onClose={() => setConfirmDelete(null)}>
        {confirmDelete && (
          <div className="space-y-4">
            <p className="text-sm" style={{ color: 'var(--text)' }}>
              Delete <code className="font-mono">{confirmDelete.name}</code> and all{' '}
              {confirmDelete.file_count} {confirmDelete.file_count === 1 ? 'file' : 'files'}{' '}
              inside it? This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(null)} className="btn-secondary px-3 py-2" disabled={deleting}>
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-3 py-2 rounded-xl flex items-center gap-2 font-medium"
                style={{ backgroundColor: 'var(--danger)', color: 'white' }}
              >
                {deleting && <Loader2 size={14} className="animate-spin" />}
                Delete bucket
              </button>
            </div>
          </div>
        )}
      </Modal>

      {toast && (
        <Toast key={toast.id} message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />
      )}
    </div>
  )
}
