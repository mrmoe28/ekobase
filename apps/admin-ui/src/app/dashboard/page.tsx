'use client'

import { useEffect, useState } from 'react'
import { Users, HardDrive, FileText, FolderKanban } from 'lucide-react'
import StatCard from '@/components/StatCard'
import { getStats, type Stats } from '@/lib/api'

export default function OverviewPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getStats()
      .then(setStats)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold" style={{ color: 'var(--text)' }}>
          Welcome back
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
          Here&apos;s an overview of your instance.
        </p>
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
          Failed to load stats: {error}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Projects" value={stats?.projects ?? null} icon={FolderKanban} loading={loading} />
        <StatCard label="Total Users" value={stats?.users ?? null} icon={Users} loading={loading} />
        <StatCard label="Storage Buckets" value={stats?.buckets ?? null} icon={HardDrive} loading={loading} />
        <StatCard label="Total Files" value={stats?.files ?? null} icon={FileText} loading={loading} />
      </div>

      {/* Divider section */}
      <div
        className="rounded-xl p-5"
        style={{
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
        }}
      >
        <h2 className="text-sm font-semibold mb-1" style={{ color: 'var(--text)' }}>
          Quick links
        </h2>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Use the sidebar to navigate to Users or Tenants management. You can create, delete,
          and impersonate users, and manage tenant records.
        </p>
      </div>
    </div>
  )
}
