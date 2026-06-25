'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Shield, Plus, Trash2, Loader2, KeyRound, Copy, Check } from 'lucide-react'
import {
  listProjectMembers,
  addProjectMember,
  removeProjectMember,
  listUsers,
  impersonateUser,
  createInviteToken,
  type User,
  type InviteToken,
} from '@/lib/api'
import Modal from '@/components/Modal'
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
  const [minting, setMinting] = useState<string | null>(null)
  const [token, setToken] = useState<{ user: User; access_token: string; expires_in: number } | null>(null)
  const [copied, setCopied] = useState(false)
  const [inviteUser, setInviteUser] = useState<User | null>(null)
  const [inviteToken, setInviteToken] = useState<InviteToken | null>(null)
  const [inviteCopied, setInviteCopied] = useState(false)
  const [generatingInvite, setGeneratingInvite] = useState<string | null>(null)
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

  const handleMint = async (member: User) => {
    setMinting(member.id)
    try {
      const result = await impersonateUser(member.id, id)
      setToken({ user: member, access_token: result.access_token, expires_in: result.expires_in })
      setCopied(false)
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to mint token', 'error')
    } finally {
      setMinting(null)
    }
  }

  const copyToken = async () => {
    if (!token) return
    await navigator.clipboard.writeText(token.access_token)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleGenerateInvite = async (member: User) => {
    setGeneratingInvite(member.id)
    try {
      const tok = await createInviteToken(member.id)
      setInviteUser(member)
      setInviteToken(tok)
      setInviteCopied(false)
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to generate invite', 'error')
    } finally {
      setGeneratingInvite(null)
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
                    onClick={() => handleGenerateInvite(member)}
                    disabled={generatingInvite === member.id}
                    title="Generate invite link"
                    className="p-1.5 rounded-lg transition-colors"
                    style={{ color: 'var(--text-muted)' }}
                    onMouseEnter={e => { e.currentTarget.style.color = '#22c55e' }}
                    onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}
                  >
                    {generatingInvite === member.id
                      ? <Loader2 size={14} className="animate-spin" />
                      : <Plus size={14} />}
                  </button>
                  <button
                    onClick={() => handleMint(member)}
                    disabled={minting === member.id}
                    title="Generate user access token"
                    className="p-1.5 rounded-lg transition-colors"
                    style={{ color: 'var(--text-muted)' }}
                    onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent)' }}
                    onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}
                  >
                    {minting === member.id
                      ? <Loader2 size={14} className="animate-spin" />
                      : <KeyRound size={14} />}
                  </button>
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

      <Modal
        isOpen={token !== null}
        title="User access token"
        onClose={() => setToken(null)}
      >
        {token && (
          <div className="space-y-4">
            <div>
              <p className="label mb-1">User</p>
              <p className="text-sm" style={{ color: 'var(--text)' }}>{token.user.email}</p>
            </div>
            <div>
              <p className="label mb-1">Access token (expires in {Math.round(token.expires_in / 60)} min)</p>
              <div className="flex items-center gap-2">
                <code
                  className="flex-1 px-3 py-2 rounded-xl text-xs font-mono break-all"
                  style={{
                    backgroundColor: 'var(--bg)',
                    border: '1px solid var(--border)',
                    color: 'var(--text)',
                    maxHeight: '120px',
                    overflowY: 'auto',
                  }}
                >
                  {token.access_token}
                </code>
                <button
                  onClick={copyToken}
                  className="p-2 rounded-xl shrink-0"
                  style={{
                    border: '1px solid var(--border)',
                    color: copied ? 'var(--accent)' : 'var(--text-muted)',
                  }}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            </div>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Use as the <code>Authorization: Bearer &lt;token&gt;</code> header. The token is scoped to this project — requests will route to its schema.
            </p>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={inviteToken !== null}
        title="Invite link"
        onClose={() => { setInviteToken(null); setInviteUser(null) }}
      >
        {inviteToken && inviteUser && (
          <div className="space-y-4">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Share this one-time link with <strong style={{ color: 'var(--text)' }}>{inviteUser.email}</strong> to let them set a password.
              Expires {new Date(inviteToken.expires_at).toLocaleString()}.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2 rounded-xl text-xs font-mono break-all"
                style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)' }}>
                {inviteToken.token}
              </code>
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(inviteToken.token)
                  setInviteCopied(true)
                  setTimeout(() => setInviteCopied(false), 2000)
                }}
                className="p-2 rounded-xl shrink-0"
                style={{ border: '1px solid var(--border)', color: inviteCopied ? 'var(--accent)' : 'var(--text-muted)' }}
              >
                {inviteCopied ? <Check size={14} /> : <Copy size={14} />}
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
