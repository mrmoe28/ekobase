'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  Copy, Check, Eye, EyeOff, Terminal, Table2, Zap, Users,
  FolderKanban, Loader2,
} from 'lucide-react'
import { useProject } from '@/contexts/project'
import { getProjectKeys, listProjectMembers, type User } from '@/lib/api'

export default function ProjectOverviewPage() {
  const project = useProject()
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  const [keys, setKeys] = useState<{ anon_key: string; service_role_key: string } | null>(null)
  const [members, setMembers] = useState<User[]>([])
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})
  const [copied, setCopied] = useState<string | null>(null)

  const projectSchema = 'proj_' + id.replace(/-/g, '').slice(0, 16)

  useEffect(() => {
    getProjectKeys(id).then(setKeys).catch(() => {})
    listProjectMembers(id).then(setMembers).catch(() => {})
  }, [id])

  if (!project) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 size={24} className="animate-spin" style={{ color: 'var(--accent)' }} />
      </div>
    )
  }

  const copy = async (val: string, label: string) => {
    await navigator.clipboard.writeText(val)
    setCopied(label)
    setTimeout(() => setCopied(null), 2000)
  }

  const quickActions = [
    { label: 'Table Editor', icon: Table2, href: `/dashboard/projects/${id}/editor` },
    { label: 'SQL Editor', icon: Terminal, href: `/dashboard/projects/${id}/sql` },
    { label: 'Edge Functions', icon: Zap, href: `/dashboard/projects/${id}/functions` },
  ]

  const keyRows = keys
    ? [
        { label: 'Anon key', value: keys.anon_key },
        { label: 'Service role key', value: keys.service_role_key },
      ]
    : []

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start gap-3">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 15%, transparent)' }}
        >
          <FolderKanban size={18} style={{ color: 'var(--accent)' }} />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text)' }}>
            {project.name}
          </h1>
          {project.description && (
            <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {project.description}
            </p>
          )}
        </div>
        <span
          className="text-xs font-mono px-2 py-1 rounded-lg shrink-0"
          style={{
            backgroundColor: 'var(--bg)',
            border: '1px solid var(--border)',
            color: 'var(--text-muted)',
          }}
        >
          {project.region}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {quickActions.map(({ label, icon: Icon, href }) => (
          <button
            key={href}
            onClick={() => router.push(href)}
            className="flex flex-col items-center gap-2 p-4 rounded-xl text-sm font-medium card transition-colors duration-150"
            style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'var(--accent)'
              e.currentTarget.style.color = 'var(--accent)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--border)'
              e.currentTarget.style.color = 'var(--text-muted)'
            }}
          >
            <Icon size={20} />
            {label}
          </button>
        ))}
      </div>

      <div className="card p-5" style={{ border: '1px solid var(--border)' }}>
        <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--text)' }}>
          API configuration
        </h2>
        <div className="space-y-3">
          <div>
            <p className="label mb-1">Project schema</p>
            <div className="flex items-center gap-2">
              <code
                className="flex-1 px-3 py-2 rounded-xl text-xs font-mono"
                style={{
                  backgroundColor: 'var(--bg)',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                }}
              >
                {projectSchema}
              </code>
              <button
                onClick={() => copy(projectSchema, 'schema')}
                className="p-2 rounded-xl"
                style={{
                  border: '1px solid var(--border)',
                  color: copied === 'schema' ? 'var(--accent)' : 'var(--text-muted)',
                }}
              >
                {copied === 'schema' ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          </div>

          {keyRows.map(({ label, value }) => (
            <div key={label}>
              <p className="label mb-1">{label}</p>
              <div className="flex items-center gap-2">
                <div
                  className="flex-1 flex items-center rounded-xl px-3 py-2 font-mono text-xs overflow-hidden"
                  style={{
                    backgroundColor: 'var(--bg)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-muted)',
                  }}
                >
                  <span className="truncate">
                    {revealed[label] ? value : `${value.slice(0, 20)}${'•'.repeat(20)}`}
                  </span>
                </div>
                <button
                  onClick={() => setRevealed(r => ({ ...r, [label]: !r[label] }))}
                  className="p-2 rounded-xl"
                  style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }}
                >
                  {revealed[label] ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                <button
                  onClick={() => copy(value, label)}
                  className="p-2 rounded-xl"
                  style={{
                    border: '1px solid var(--border)',
                    color: copied === label ? 'var(--accent)' : 'var(--text-muted)',
                  }}
                >
                  {copied === label ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card p-5" style={{ border: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
            Members
          </h2>
          <span
            className="text-xs px-1.5 py-0.5 rounded-full font-medium"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--accent) 15%, transparent)',
              color: 'var(--accent)',
            }}
          >
            {members.length}
          </span>
        </div>
        {members.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            No members — add them in Project Settings.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {members.map(m => (
              <span
                key={m.id}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs"
                style={{
                  backgroundColor: 'var(--bg)',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                }}
              >
                <Users size={11} style={{ color: 'var(--text-muted)' }} />
                {m.email}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
