'use client'

import type { LucideIcon } from 'lucide-react'

interface StatCardProps {
  label: string
  value: number | null
  icon: LucideIcon
  loading?: boolean
}

export default function StatCard({ label, value, icon: Icon, loading }: StatCardProps) {
  return (
    <div className="card p-6 flex items-start justify-between">
      <div className="flex flex-col gap-2">
        <span
          className="text-sm font-medium"
          style={{ color: 'var(--text-muted)' }}
        >
          {label}
        </span>
        {loading || value === null ? (
          <div className="skeleton h-9 w-24" />
        ) : (
          <span
            className="text-4xl font-semibold tracking-tight"
            style={{ color: 'var(--text)' }}
          >
            {value.toLocaleString()}
          </span>
        )}
      </div>
      <div
        className="p-3 rounded-xl"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--accent) 15%, transparent)',
        }}
      >
        <Icon
          size={22}
          style={{ color: 'var(--accent)' }}
        />
      </div>
    </div>
  )
}
