'use client'

import { Github } from 'lucide-react'

function IntegrationSection({
  title,
  description,
  icon,
  children,
  howTitle,
  howText,
}: {
  title: string
  description: string
  icon: React.ReactNode
  children: React.ReactNode
  howTitle: string
  howText: string
}) {
  return (
    <div
      className="grid grid-cols-1 lg:grid-cols-2 gap-8 py-10"
      style={{ borderBottom: '1px solid var(--border)' }}
    >
      {/* Left */}
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--text)' }}>{title}</h2>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{description}</p>
        </div>
        <div
          className="w-24 h-24 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          {icon}
        </div>
      </div>

      {/* Right */}
      <div className="space-y-4">
        <div
          className="rounded-xl p-5 space-y-3"
          style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <h3 className="text-sm font-medium" style={{ color: 'var(--text)' }}>{howTitle}</h3>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>{howText}</p>
        </div>
        {children}
      </div>
    </div>
  )
}

function ConnectButton({ label }: { label: string }) {
  return (
    <div
      className="rounded-xl p-4 flex items-center justify-between"
      style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <span className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
        Coming soon
      </span>
      <button
        disabled
        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium cursor-not-allowed opacity-50"
        style={{
          backgroundColor: 'var(--bg)',
          border: '1px solid var(--border)',
          color: 'var(--text-muted)',
        }}
      >
        {label}
      </button>
    </div>
  )
}

export default function IntegrationsPage() {
  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-2xl font-semibold mb-2" style={{ color: 'var(--text)' }}>Integrations</h1>

      {/* GitHub */}
      <IntegrationSection
        title="GitHub Connections"
        description="Connect any of your GitHub repositories to a project."
        icon={<Github size={40} style={{ color: 'var(--text)' }} />}
        howTitle="How do GitHub connections work?"
        howText="Connect a GitHub repository to a project. The GitHub app watches file, branch, and pull request activity in your repository."
      >
        <ConnectButton label="Add new project connection" />
        <p className="text-xs px-1" style={{ color: 'var(--text-muted)' }}>
          GitHub integration is not yet implemented.
        </p>
      </IntegrationSection>

      {/* Vercel */}
      <IntegrationSection
        title="Vercel Integration"
        description="Connect your Vercel teams to your projects."
        icon={
          <svg viewBox="0 0 116 100" width="40" height="40" fill="currentColor" style={{ color: 'var(--text)' }}>
            <path d="M57.5 0L115 100H0L57.5 0z" />
          </svg>
        }
        howTitle="How does the Vercel integration work?"
        howText="The integration will keep your environment variables up to date in each project you assign. You can also link multiple Vercel projects to the same project."
      >
        <ConnectButton label="Add new project connection" />
        <p className="text-xs px-1" style={{ color: 'var(--text-muted)' }}>
          Vercel integration is not yet implemented.
        </p>
      </IntegrationSection>

      {/* Bottom padding */}
      <div className="py-8" />
    </div>
  )
}
