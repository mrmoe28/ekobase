'use client'

import { Code2, Sparkles, Terminal, ChevronRight, BookOpen, ExternalLink } from 'lucide-react'

const DEPLOY_OPTIONS = [
  {
    icon: <Code2 size={18} />,
    title: 'Via Editor',
    description: 'Create and edit functions directly in the browser. Download to local at any time.',
    action: 'Open Editor',
  },
  {
    icon: <Sparkles size={18} />,
    title: 'AI Assistant',
    description: 'Let our AI assistant help you create functions. Perfect for kickstarting a function.',
    action: 'Open Assistant',
  },
  {
    icon: <Terminal size={18} />,
    title: 'Via CLI',
    description: 'Create and deploy functions using the CLI. Ideal for local development and version control.',
    action: 'View CLI Instructions',
  },
]

const TEMPLATES = [
  { name: 'Simple Hello World', description: 'Basic function that returns a JSON response' },
  { name: 'Database Access', description: 'Example using the client to query your database' },
  { name: 'Storage Upload', description: 'Upload files to Storage' },
  { name: 'Node Built-in API Example', description: "Example using Node.js built-in crypto and http modules" },
]

export default function FunctionsPage() {
  return (
    <div className="max-w-5xl space-y-10">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold mb-1" style={{ color: 'var(--text)' }}>Edge Functions</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Run server-side logic close to your users</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors duration-150"
            style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}
          >
            <BookOpen size={13} /> Docs
          </button>
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors duration-150"
            style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}
          >
            <ExternalLink size={13} /> Examples
          </button>
          <button className="btn-primary">
            Deploy a new function
          </button>
        </div>
      </div>

      {/* Deploy options */}
      <div
        className="rounded-xl overflow-hidden"
        style={{ border: '1px solid var(--border)' }}
      >
        <div
          className="px-5 py-3 border-b"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
        >
          <p className="text-xs font-mono font-semibold tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>
            Deploy your first edge function
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 divide-x" style={{ borderColor: 'var(--border)' }}>
          {DEPLOY_OPTIONS.map((opt, i) => (
            <div
              key={i}
              className="p-6 space-y-3"
              style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
            >
              <div className="flex items-center gap-2" style={{ color: 'var(--text)' }}>
                {opt.icon}
                <span className="font-medium text-sm">{opt.title}</span>
              </div>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                {opt.description}
              </p>
              <button
                className="px-3 py-1.5 text-sm rounded-lg transition-colors duration-150 font-medium"
                style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--text-muted)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)' }}
              >
                {opt.action}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Templates */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>Start with a template</h2>
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
          {TEMPLATES.map((t, i) => (
            <button
              key={i}
              className="w-full flex items-center justify-between px-5 py-4 text-left transition-colors duration-100"
              style={{
                borderBottom: i < TEMPLATES.length - 1 ? '1px solid var(--border)' : 'none',
                backgroundColor: 'var(--surface)',
              }}
              onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'color-mix(in srgb, var(--border) 40%, var(--surface))' }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'var(--surface)' }}
            >
              <div className="flex items-center gap-3">
                <Code2 size={16} style={{ color: 'var(--text-muted)' }} />
                <div>
                  <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>{t.name}</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t.description}</p>
                </div>
              </div>
              <ChevronRight size={16} style={{ color: 'var(--text-muted)' }} />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
