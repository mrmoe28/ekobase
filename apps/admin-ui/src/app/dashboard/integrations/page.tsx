'use client'

import { Github, Triangle, ExternalLink } from 'lucide-react'

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

function ConnectButton({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <div
      className="rounded-xl p-4 flex items-center justify-end"
      style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <button
        onClick={onClick}
        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-150"
        style={{
          backgroundColor: 'var(--bg)',
          border: '1px solid var(--border)',
          color: 'var(--text)',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.borderColor = 'var(--text-muted)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.borderColor = 'var(--border)'
        }}
      >
        {label}
      </button>
    </div>
  )
}

function TeamRow({
  name,
  meta,
  badge,
  connections,
}: {
  name: string
  meta: string
  badge?: string
  connections: number
}) {
  return (
    <div
      className="rounded-xl p-4 space-y-3"
      style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
            style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 20%, transparent)', color: 'var(--accent)' }}
          >
            {name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium" style={{ color: 'var(--text)' }}>{name}</span>
              {badge && (
                <span
                  className="text-xs px-1.5 py-0.5 rounded font-medium uppercase tracking-wide"
                  style={{
                    backgroundColor: 'color-mix(in srgb, var(--text-muted) 15%, transparent)',
                    color: 'var(--text-muted)',
                    fontSize: '10px',
                  }}
                >
                  {badge}
                </span>
              )}
            </div>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{meta}</p>
          </div>
        </div>
        <button
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors duration-150"
          style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}
        >
          Manage <ExternalLink size={12} />
        </button>
      </div>
      <div className="pt-1" style={{ borderTop: '1px solid var(--border)' }}>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {connections} project connection{connections !== 1 ? 's' : ''}
        </p>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
          Repository connections for {name.split('-')[0]}
        </p>
      </div>
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
          Connect a GitHub account to enable repository integrations.{' '}
          <button
            className="underline transition-colors duration-150"
            style={{ color: 'var(--accent)' }}
            onMouseEnter={e => { e.currentTarget.style.opacity = '0.75' }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
          >
            Configure GitHub App
          </button>
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
        <TeamRow
          name="eko-app-development"
          meta="Added by ekosolarize@gmail.com"
          badge="TEAM"
          connections={0}
        />
        <ConnectButton label="Add new project connection" />
      </IntegrationSection>

      {/* Bottom padding */}
      <div className="py-8" />
    </div>
  )
}
