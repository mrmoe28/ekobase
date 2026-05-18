'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Shield, Plus, Trash2, Loader2 } from 'lucide-react'
import { listProjectMembers, addProjectMember, removeProjectMember, listUsers, type User } from '@/lib/api'
import Toast, { type ToastType } from '@/components/Toast'

interface ToastState { message: string; type: ToastType; id: number }

export default function ProjectAuthPage() {
  const { id } = useParams<{ id: string }>()

  const [members, setMembers] = useState<User[]>([])
  const [allUsers, setAllUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedUserId, setSelectedUserId] = useState('')
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)

  const showToast = (message: string, type: ToastType) =>
    setToast({ message, type, id: Date.now() })

  useEffect(() => {
    Promise.all([listProjectMembers(id), listUsers()])
      .then(([m, u]) => { setMembers(m); setAllUsers(u) })
      .catch(() => showToast('Failed to load members', 'error'))
      .finally(() => setLoading(false))
  }, [id])

  const memberIds = new Set(members.map(m => m.id))
  const addable = allUsers.filter(u => !memberIds.has(u.id))

  const handleAdd = async () => {
    if (!selectedUserId) return
    setAdding(true)
    try {
      const user = await addProjectMember(id, selectedUserId)
      setMembers(prev => [...prev, user])
      setSelectedUserId('')
      showToast('User added to project', 'success')
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to add user', 'error')
    } finally {
      setAdding(false)
    }
  }

  const handleRemove = async (userId: string) => {
    setRemoving(userId)
    try {
      await removeProjectMember(id, userId)
      setMembers(prev => prev.filter(m => m.id !== userId))
      showToast('User removed from project', 'success')
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to remove user', 'error')
    } finally {
      setRemoving(null)
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 15%, transparent)' }}>
          <Shield size={16} style={{ color: 'var(--accent)' }} />
        </div>
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text)' }}>Authentication</h1>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Manage users with access to this project
          </p>
        </div>
      </div>

      <div className="card p-5" style={{ border: '1px solid var(--border)' }}>
        <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--text)' }}>Project users</h2>

        <div className="flex gap-2 mb-5">
          <select
            className="input-field flex-1"
            value={selectedUserId}
            onChange={e => setSelectedUserId(e.target.value)}
            disabled={adding}
          >
            <option value="">Grant access to a user…</option>
            {addable.map(u => <option key={u.id} value={u.id}>{u.email}</option>)}
          </select>
          <button
            onClick={handleAdd}
            disabled={!selectedUserId || adding}
            className="btn-primary px-3"
          >
            {adding ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
          </button>
        </div>

        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map(i => <div key={i} className="skeleton h-12 w-full" />)}
          </div>
        ) : members.length === 0 ? (
          <div className="text-center py-8">
            <Shield size={28} className="mx-auto mb-2" style={{ color: 'var(--text-muted)' }} />
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No users have access to this project yet.</p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {members.map(member => (
              <div key={member.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>{member.email}</p>
                  <p className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{member.id}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{
                      backgroundColor: 'color-mix(in srgb, var(--accent) 10%, transparent)',
                      color: 'var(--accent)',
                    }}>
                    member
                  </span>
                  <button
                    onClick={() => handleRemove(member.id)}
                    disabled={removing === member.id}
                    className="p-1.5 rounded-lg transition-colors"
                    style={{ color: 'var(--text-muted)' }}
                    onMouseEnter={e => { e.currentTarget.style.color = 'var(--danger)' }}
                    onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}
                  >
                    {removing === member.id
                      ? <Loader2 size={14} className="animate-spin" />
                      : <Trash2 size={14} />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {toast && (
        <Toast key={toast.id} message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />
      )}
    </div>
  )
}
