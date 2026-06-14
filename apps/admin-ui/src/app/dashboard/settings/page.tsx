'use client'

import { Settings2, Shield } from 'lucide-react'
import FunctionSecretsManager from '@/components/FunctionSecretsManager'

export default function AdminSettingsPage() {
  return (
    <div className="max-w-5xl space-y-8">
      <div
        className="rounded-2xl p-6"
        style={{
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
        }}
      >
        <div className="flex items-start gap-4">
          <div
            className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
            style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 16%, transparent)' }}
          >
            <Settings2 size={20} style={{ color: 'var(--accent)' }} />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold" style={{ color: 'var(--text)' }}>
              Admin settings
            </h1>
            <p className="text-sm max-w-3xl" style={{ color: 'var(--text-muted)' }}>
              Configure instance-wide behavior here. These settings apply across Ekobase, unlike project
              settings which only affect a single project.
            </p>
          </div>
        </div>
      </div>

      <div
        className="rounded-2xl p-5"
        style={{
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
        }}
      >
        <div className="flex items-start gap-3">
          <Shield size={18} className="mt-0.5 shrink-0" style={{ color: 'var(--accent)' }} />
          <div>
            <h2 className="text-sm font-semibold mb-1" style={{ color: 'var(--text)' }}>
              Instance scope
            </h2>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Global function secrets live here because they are shared by all projects. Project-specific
              metadata and membership remain under each project&apos;s settings page.
            </p>
          </div>
        </div>
      </div>

      <FunctionSecretsManager />
    </div>
  )
}
