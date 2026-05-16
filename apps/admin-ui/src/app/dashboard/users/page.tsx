'use client'

import { useEffect, useState, type FormEvent } from 'react'
import {
  Plus,
  Trash2,
  Copy,
  UserX,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import Modal from '@/components/Modal'
import Toast, { type ToastType } from '@/components/Toast'
import {
  listUsers,
  createUser,
  deleteUser,
  impersonateUser,
  type User,
} from '@/lib/api'

interface ToastState {
  message: string
  type: ToastType
  id: number
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)

  // New user form
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [creating, setCreating] = useState(false)
  const [formError, setFormError] = useState('')

  // Action loading states
  const [impersonating, setImpersonating] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const showToast = (message: string, type: ToastType) => {
    setToast({ message, type, id: Date.now() })
  }

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await listUsers()
      setUsers(data)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const handleCreateUser = async (e: FormEvent) => {
    e.preventDefault()
    setFormError('')
    if (!email.trim()) { setFormError('Email is required.'); return }
    if (!password.trim()) { setFormError('Password is required.'); return }
    setCreating(true)
    try {
      const user = await createUser(email.trim(), password)
      setUsers((prev) => [user, ...prev])
      setEmail('')
      setPassword('')
      setShowModal(false)
      showToast(`User ${user.email} created.`, 'success')
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to create user')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (user: User) => {
    if (!confirm(`Delete user "${user.email}"? This action cannot be undone.`)) return
    setDeleting(user.id)
    try {
      await deleteUser(user.id)
      setUsers((prev) => prev.filter((u) => u.id !== user.id))
      showToast(`User ${user.email} deleted.`, 'success')
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to delete user', 'error')
    } finally {
      setDeleting(null)
    }
  }

  const handleImpersonate = async (user: User) => {
    setImpersonating(user.id)
    try {
      const result = await impersonateUser(user.id)
      await navigator.clipboard.writeText(result.access_token)
      showToast('Token copied to clipboard!', 'success')
    } catch (err: unknown) {
      showToast(
        err instanceof Error ? err.message : 'Failed to impersonate user',
        'error',
      )
    } finally {
      setImpersonating(null)
    }
  }

  const closeModal = () => {
    if (creating) return
    setShowModal(false)
    setEmail('')
    setPassword('')
    setFormError('')
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--text)' }}>
            Users
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Manage user accounts in your instance.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="btn-ghost"
            disabled={loading}
            aria-label="Refresh users"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="btn-primary"
          >
            <Plus size={16} />
            New User
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div
          className="rounded-xl px-4 py-3 text-sm"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--danger) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)',
            color: 'var(--danger)',
          }}
        >
          {error}
        </div>
      )}

      {/* Table */}
      <div
        className="card overflow-hidden"
        style={{ backgroundColor: 'var(--surface)' }}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th
                  className="text-left px-5 py-3.5 font-medium"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Email
                </th>
                <th
                  className="text-left px-5 py-3.5 font-medium"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Created
                </th>
                <th
                  className="text-right px-5 py-3.5 font-medium"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td className="px-5 py-4">
                      <div className="skeleton h-4 w-48" />
                    </td>
                    <td className="px-5 py-4">
                      <div className="skeleton h-4 w-24" />
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="skeleton h-4 w-32 ml-auto" />
                    </td>
                  </tr>
                ))
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-5 py-12 text-center">
                    <UserX size={36} className="mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
                    <p className="font-medium" style={{ color: 'var(--text)' }}>
                      No users yet
                    </p>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                      Create your first user with the button above.
                    </p>
                  </td>
                </tr>
              ) : (
                users.map((user, idx) => (
                  <tr
                    key={user.id}
                    className="table-row-hover transition-colors duration-150"
                    style={{
                      borderBottom:
                        idx < users.length - 1 ? '1px solid var(--border)' : 'none',
                    }}
                  >
                    <td className="px-5 py-3.5">
                      <span style={{ color: 'var(--text)' }}>{user.email}</span>
                      <br />
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {user.id}
                      </span>
                    </td>
                    <td
                      className="px-5 py-3.5 whitespace-nowrap"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {formatDate(user.created_at)}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleImpersonate(user)}
                          disabled={impersonating === user.id}
                          className="btn-ghost text-xs py-1.5 px-2.5"
                          title="Copy impersonation token"
                        >
                          {impersonating === user.id ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Copy size={12} />
                          )}
                          Impersonate
                        </button>
                        <button
                          onClick={() => handleDelete(user)}
                          disabled={deleting === user.id}
                          className="btn-danger text-xs py-1.5 px-2.5"
                          title="Delete user"
                        >
                          {deleting === user.id ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Trash2 size={12} />
                          )}
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* New User Modal */}
      {showModal && (
        <Modal title="Create New User" onClose={closeModal}>
          <form onSubmit={handleCreateUser} className="space-y-4">
            <div>
              <label htmlFor="new-email" className="label">
                Email address
              </label>
              <input
                id="new-email"
                type="email"
                className="input-field"
                placeholder="user@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={creating}
                autoFocus
              />
            </div>
            <div>
              <label htmlFor="new-password" className="label">
                Password
              </label>
              <input
                id="new-password"
                type="password"
                className="input-field"
                placeholder="Minimum 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={creating}
              />
            </div>
            {formError && (
              <p className="text-sm" style={{ color: 'var(--danger)' }}>
                {formError}
              </p>
            )}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={closeModal}
                className="btn-ghost"
                disabled={creating}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={creating}
              >
                {creating ? <Loader2 size={14} className="animate-spin" /> : null}
                {creating ? 'Creating...' : 'Create User'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Toast */}
      {toast && (
        <Toast
          key={toast.id}
          message={toast.message}
          type={toast.type}
          onDismiss={() => setToast(null)}
        />
      )}
    </div>
  )
}
