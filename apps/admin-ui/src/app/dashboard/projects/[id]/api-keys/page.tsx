'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Key, Copy, Check, Trash2, Loader2, ShieldAlert } from 'lucide-react'
import { listApiKeys, createApiKey, revokeApiKey, deleteApiKey, type ApiKey } from '@/lib/api'

export default function ApiKeysPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [newScopes, setNewScopes] = useState<string[]>(['read', 'write'])
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const data = await listApiKeys(projectId)
      setKeys(data)
    } catch {
      setKeys([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [projectId])

  async function handleCreate() {
    if (!newName.trim()) return
    setBusy('create')
    try {
      const result = await createApiKey(projectId, { name: newName.trim(), scopes: newScopes })
      setCreatedKey(result.api_key)
      setNewName('')
      await load()
    } catch (e: any) {
      alert(e.message ?? 'Failed to create key')
    } finally {
      setBusy(null)
    }
  }

  async function handleRevoke(keyId: string) {
    if (!confirm('Revoke this API key? It will no longer work.')) return
    setBusy(keyId)
    try {
      await revokeApiKey(projectId, keyId)
      await load()
    } catch (e: any) {
      alert(e.message ?? 'Failed to revoke key')
    } finally {
      setBusy(null)
    }
  }

  async function handleDelete(keyId: string) {
    if (!confirm('Delete this API key permanently?')) return
    setBusy(keyId)
    try {
      await deleteApiKey(projectId, keyId)
      await load()
    } catch (e: any) {
      alert(e.message ?? 'Failed to delete key')
    } finally {
      setBusy(null)
    }
  }

  const copy = async (val: string, id: string) => {
    await navigator.clipboard.writeText(val)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  const activeKeys = keys.filter(k => !k.revoked)
  const revokedKeys = keys.filter(k => k.revoked)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 15%, transparent)' }}
        >
          <Key size={18} style={{ color: 'var(--accent)' }} />
        </div>
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text)' }}>
            API Keys
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Manage keys for external apps and SDKs to connect to this project.
          </p>
        </div>
      </div>

      {/* Project URL card */}
      <div
        className="card p-4"
        style={{ border: '1px solid var(--border)' }}
      >
        <p className="text-sm font-medium mb-2" style={{ color: 'var(--text)' }}>
          Project URL
        </p>
        <div className="flex items-center gap-2">
          <code
            className="flex-1 px-3 py-2 rounded-lg text-xs font-mono truncate"
            style={{
              backgroundColor: 'var(--bg)',
              border: '1px solid var(--border)',
              color: 'var(--text)',
            }}
          >
            {typeof window !== 'undefined'
              ? `${window.location.origin}/p/${projectId}`
              : `https://gateway.example.com/p/${projectId}`}
          </code>
          <button
            onClick={() =>
              copy(
                typeof window !== 'undefined'
                  ? `${window.location.origin}/p/${projectId}`
                  : `https://gateway.example.com/p/${projectId}`,
                'url',
              )
            }
            className="p-2 rounded-lg"
            style={{
              border: '1px solid var(--border)',
              color: copied === 'url' ? 'var(--accent)' : 'var(--text-muted)',
            }}
          >
            {copied === 'url' ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
      </div>

      {/* Created key banner */}
      {createdKey && (
        <div
          className="rounded-lg p-4 flex flex-col gap-2"
          style={{
            border: '1px solid var(--accent)',
            backgroundColor: 'color-mix(in srgb, var(--accent) 8%, transparent)',
          }}
        >
          <div className="flex items-center gap-2">
            <ShieldAlert size={16} style={{ color: 'var(--accent)' }} />
            <p className="text-sm font-semibold" style={{ color: 'var(--accent)' }}>
              API key created — copy it now, it will never be shown again
            </p>
          </div>
          <div className="flex items-center gap-2">
            <code
              className="flex-1 px-3 py-2 rounded-lg text-xs font-mono break-all"
              style={{
                backgroundColor: 'var(--bg)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
              }}
            >
              {createdKey}
            </code>
            <button
              onClick={() => copy(createdKey, 'created')}
              className="p-2 rounded-lg"
              style={{
                border: '1px solid var(--border)',
                color: copied === 'created' ? 'var(--accent)' : 'var(--text-muted)',
              }}
            >
              {copied === 'created' ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
          <button
            onClick={() => setCreatedKey(null)}
            className="text-xs underline self-start"
            style={{ color: 'var(--text-muted)' }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Create form */}
      <div
        className="card p-4 flex flex-wrap items-end gap-3"
        style={{ border: '1px solid var(--border)' }}
      >
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
            Key name
          </label>
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
            placeholder="e.g. Production SDK"
            className="w-full px-3 py-2 rounded-lg text-sm"
            style={{
              backgroundColor: 'var(--bg)',
              border: '1px solid var(--border)',
              color: 'var(--text)',
            }}
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
            Scopes
          </label>
          <div className="flex gap-2">
            {['read', 'write', 'admin'].map(scope => (
              <label
                key={scope}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs cursor-pointer"
                style={{
                  border: '1px solid var(--border)',
                  backgroundColor: newScopes.includes(scope)
                    ? 'color-mix(in srgb, var(--accent) 12%, transparent)'
                    : 'var(--bg)',
                  color: newScopes.includes(scope) ? 'var(--accent)' : 'var(--text-muted)',
                }}
              >
                <input
                  type="checkbox"
                  checked={newScopes.includes(scope)}
                  onChange={e => {
                    if (e.target.checked) setNewScopes([...newScopes, scope])
                    else setNewScopes(newScopes.filter(s => s !== scope))
                  }}
                  className="sr-only"
                />
                {scope}
              </label>
            ))}
          </div>
        </div>
        <button
          onClick={handleCreate}
          disabled={!newName.trim() || busy === 'create'}
          className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity"
          style={{
            backgroundColor: 'var(--accent)',
            opacity: !newName.trim() || busy === 'create' ? 0.6 : 1,
          }}
        >
          {busy === 'create' ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            'Create Key'
          )}
        </button>
      </div>

      {/* Active keys table */}
      {loading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 size={24} className="animate-spin" style={{ color: 'var(--accent)' }} />
        </div>
      ) : activeKeys.length === 0 && revokedKeys.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center h-40 rounded-lg"
          style={{ border: '1px dashed var(--border)' }}
        >
          <Key size={24} style={{ color: 'var(--text-muted)' }} />
          <p className="text-sm mt-2" style={{ color: 'var(--text-muted)' }}>
            No API keys yet. Create one above.
          </p>
        </div>
      ) : (
        <>
          {activeKeys.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>
                Active keys ({activeKeys.length})
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <th className="py-2 px-3 font-medium" style={{ color: 'var(--text-muted)' }}>Name</th>
                      <th className="py-2 px-3 font-medium" style={{ color: 'var(--text-muted)' }}>Key preview</th>
                      <th className="py-2 px-3 font-medium" style={{ color: 'var(--text-muted)' }}>Scopes</th>
                      <th className="py-2 px-3 font-medium" style={{ color: 'var(--text-muted)' }}>Last used</th>
                      <th className="py-2 px-3 font-medium" style={{ color: 'var(--text-muted)' }}>Created</th>
                      <th className="py-2 px-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeKeys.map(k => (
                      <tr key={k.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td className="py-2 px-3 font-medium" style={{ color: 'var(--text)' }}>{k.name}</td>
                        <td className="py-2 px-3">
                          <code
                            className="px-2 py-0.5 rounded text-xs font-mono"
                            style={{
                              backgroundColor: 'var(--bg)',
                              border: '1px solid var(--border)',
                              color: 'var(--text-muted)',
                            }}
                          >
                            {k.key_preview}
                          </code>
                        </td>
                        <td className="py-2 px-3">
                          <div className="flex gap-1">
                            {k.scopes.map(s => (
                              <span
                                key={s}
                                className="px-1.5 py-0.5 rounded text-xs"
                                style={{
                                  backgroundColor: 'color-mix(in srgb, var(--accent) 10%, transparent)',
                                  color: 'var(--accent)',
                                }}
                              >
                                {s}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-2 px-3" style={{ color: 'var(--text-muted)' }}>
                          {k.last_used_at ? new Date(k.last_used_at).toLocaleString() : 'Never'}
                        </td>
                        <td className="py-2 px-3" style={{ color: 'var(--text-muted)' }}>
                          {new Date(k.created_at).toLocaleDateString()}
                        </td>
                        <td className="py-2 px-3">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleRevoke(k.id)}
                              disabled={busy === k.id}
                              className="px-2 py-1 rounded text-xs font-medium transition-colors"
                              style={{
                                border: '1px solid var(--border)',
                                color: 'var(--text-muted)',
                              }}
                              onMouseEnter={e => { e.currentTarget.style.color = '#ef4444' }}
                              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}
                            >
                              {busy === k.id ? <Loader2 size={12} className="animate-spin" /> : 'Revoke'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {revokedKeys.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
                Revoked keys ({revokedKeys.length})
              </p>
              <div className="overflow-x-auto opacity-60">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <th className="py-2 px-3 font-medium" style={{ color: 'var(--text-muted)' }}>Name</th>
                      <th className="py-2 px-3 font-medium" style={{ color: 'var(--text-muted)' }}>Key preview</th>
                      <th className="py-2 px-3 font-medium" style={{ color: 'var(--text-muted)' }}>Scopes</th>
                      <th className="py-2 px-3 font-medium" style={{ color: 'var(--text-muted)' }}>Created</th>
                      <th className="py-2 px-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {revokedKeys.map(k => (
                      <tr key={k.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td className="py-2 px-3" style={{ color: 'var(--text-muted)' }}>{k.name}</td>
                        <td className="py-2 px-3">
                          <code
                            className="px-2 py-0.5 rounded text-xs font-mono"
                            style={{
                              backgroundColor: 'var(--bg)',
                              border: '1px solid var(--border)',
                              color: 'var(--text-muted)',
                            }}
                          >
                            {k.key_preview}
                          </code>
                        </td>
                        <td className="py-2 px-3">
                          <div className="flex gap-1">
                            {k.scopes.map(s => (
                              <span
                                key={s}
                                className="px-1.5 py-0.5 rounded text-xs"
                                style={{
                                  backgroundColor: 'var(--bg)',
                                  border: '1px solid var(--border)',
                                  color: 'var(--text-muted)',
                                }}
                              >
                                {s}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-2 px-3" style={{ color: 'var(--text-muted)' }}>
                          {new Date(k.created_at).toLocaleDateString()}
                        </td>
                        <td className="py-2 px-3">
                          <button
                            onClick={() => handleDelete(k.id)}
                            disabled={busy === k.id}
                            className="p-1 rounded transition-colors"
                            style={{ color: 'var(--text-muted)' }}
                            onMouseEnter={e => { e.currentTarget.style.color = '#ef4444' }}
                            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}
                          >
                            {busy === k.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
