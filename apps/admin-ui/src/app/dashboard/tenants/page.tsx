'use client'

import { useEffect, useState, type FormEvent } from 'react'
import {
  Plus,
  Trash2,
  Building2,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import Modal from '@/components/Modal'
import Toast, { type ToastType } from '@/components/Toast'
import {
  listTenants,
  createTenant,
  deleteTenant,
  type Tenant,
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

export default function TenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)

  // New tenant form
  const [name, setName] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [creating, setCreating] = useState(false)
  const [formError, setFormError] = useState('')

  // Action loading states
  const [deleting, setDeleting] = useState<string | null>(null)

  const showToast = (message: string, type: ToastType) => {
    setToast({ message, type, id: Date.now() })
  }

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await listTenants()
      setTenants(data)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load tenants')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const handleCreateTenant = async (e: FormEvent) => {
    e.preventDefault()
    setFormError('')
    if (!name.trim()) { setFormError('Name is required.'); return }
    if (!ownerId.trim()) { setFormError('Owner ID is required.'); return }
    setCreating(true)
    try {
      const tenant = await createTenant(name.trim(), ownerId.trim())
      setTenants((prev) => [tenant, ...prev])
      setName('')
      setOwnerId('')
      setShowModal(false)
      showToast(`Tenant "${tenant.name}" created.`, 'success')
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to create tenant')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (tenant: Tenant) => {
    if (!confirm(`Delete tenant "${tenant.name}"? This action cannot be undone.`)) return
    setDeleting(tenant.id)
    try {
      await deleteTenant(tenant.id)
      setTenants((prev) => prev.filter((t) => t.id !== tenant.id))
      showToast(`Tenant "${tenant.name}" deleted.`, 'success')
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to delete tenant', 'error')
    } finally {
      setDeleting(null)
    }
  }

  const closeModal = () => {
    if (creating) return
    setShowModal(false)
    setName('')
    setOwnerId('')
    setFormError('')
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--text)' }}>
            Tenants
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Manage tenant organizations in your instance.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="btn-ghost"
            disabled={loading}
            aria-label="Refresh tenants"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="btn-primary"
          >
            <Plus size={16} />
            New Tenant
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
                  Name
                </th>
                <th
                  className="text-left px-5 py-3.5 font-medium"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Owner ID
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
                      <div className="skeleton h-4 w-32" />
                    </td>
                    <td className="px-5 py-4">
                      <div className="skeleton h-4 w-48" />
                    </td>
                    <td className="px-5 py-4">
                      <div className="skeleton h-4 w-24" />
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="skeleton h-4 w-16 ml-auto" />
                    </td>
                  </tr>
                ))
              ) : tenants.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-5 py-12 text-center">
                    <Building2
                      size={36}
                      className="mx-auto mb-3"
                      style={{ color: 'var(--text-muted)' }}
                    />
                    <p className="font-medium" style={{ color: 'var(--text)' }}>
                      No tenants yet
                    </p>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                      Create your first tenant with the button above.
                    </p>
                  </td>
                </tr>
              ) : (
                tenants.map((tenant, idx) => (
                  <tr
                    key={tenant.id}
                    className="table-row-hover transition-colors duration-150"
                    style={{
                      borderBottom:
                        idx < tenants.length - 1 ? '1px solid var(--border)' : 'none',
                    }}
                  >
                    <td className="px-5 py-3.5">
                      <span className="font-medium" style={{ color: 'var(--text)' }}>
                        {tenant.name}
                      </span>
                      <br />
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {tenant.id}
                      </span>
                    </td>
                    <td
                      className="px-5 py-3.5 font-mono text-xs"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {tenant.owner_id}
                    </td>
                    <td
                      className="px-5 py-3.5 whitespace-nowrap"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {formatDate(tenant.created_at)}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end">
                        <button
                          onClick={() => handleDelete(tenant)}
                          disabled={deleting === tenant.id}
                          className="btn-danger text-xs py-1.5 px-2.5"
                          title="Delete tenant"
                        >
                          {deleting === tenant.id ? (
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

      {/* New Tenant Modal */}
      {showModal && (
        <Modal isOpen={showModal} title="Create New Tenant" onClose={closeModal}>
          <form onSubmit={handleCreateTenant} className="space-y-4">
            <div>
              <label htmlFor="tenant-name" className="label">
                Tenant name
              </label>
              <input
                id="tenant-name"
                type="text"
                className="input-field"
                placeholder="Acme Corp"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={creating}
                autoFocus
              />
            </div>
            <div>
              <label htmlFor="tenant-owner" className="label">
                Owner ID
              </label>
              <input
                id="tenant-owner"
                type="text"
                className="input-field font-mono text-sm"
                placeholder="user UUID"
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
                disabled={creating}
              />
              <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>
                Must be the UUID of an existing user.
              </p>
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
                {creating ? 'Creating...' : 'Create Tenant'}
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
