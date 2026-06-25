'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { ScrollText, Loader2, StopCircle, Play, Trash2 } from 'lucide-react'
import { getToken } from '@/lib/auth'

interface LogLine { ts: string; level: string; service: string; message: string }

const SERVICES = ['gateway', 'admin', 'postgrest', 'auth', 'storage', 'functions', 'realtime']
const LEVELS = ['all', 'info', 'warn', 'error']

function levelColor(level: string): string {
  if (level === 'error') return '#ef4444'
  if (level === 'warn') return '#f59e0b'
  if (level === 'info') return '#22c55e'
  return 'var(--text-muted)'
}

export default function ProjectLogsPage() {
  const { id } = useParams<{ id: string }>()
  const [lines, setLines] = useState<LogLine[]>([])
  const [service, setService] = useState('gateway')
  const [level, setLevel] = useState('all')
  const [streaming, setStreaming] = useState(false)
  const esRef = useRef<EventSource | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const stop = () => {
    esRef.current?.close()
    esRef.current = null
    setStreaming(false)
  }

  const start = () => {
    stop()
    const token = getToken() ?? ''
    const params = new URLSearchParams({ project_id: id, service, level })
    const url = `/api/admin/logs/stream?${params}&token=${encodeURIComponent(token)}`
    const es = new EventSource(url)
    esRef.current = es
    setStreaming(true)

    es.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data) as LogLine
        setLines(prev => [...prev.slice(-999), parsed])
      } catch {
        setLines(prev => [...prev.slice(-999), { ts: new Date().toISOString(), level: 'info', service, message: e.data }])
      }
    }

    es.onerror = () => {
      setStreaming(false)
      esRef.current = null
    }
  }

  useEffect(() => () => stop(), [])

  useEffect(() => {
    if (bottomRef.current) bottomRef.current.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  return (
    <div className="flex flex-col gap-4 h-full max-h-[calc(100vh-120px)]">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 15%, transparent)' }}>
          <ScrollText size={16} style={{ color: 'var(--accent)' }} />
        </div>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--text)' }}>Logs</h1>

        <select value={service} onChange={e => setService(e.target.value)}
          className="input-field ml-auto" style={{ width: 'auto', minWidth: 130 }}>
          {SERVICES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <select value={level} onChange={e => setLevel(e.target.value)}
          className="input-field" style={{ width: 'auto', minWidth: 90 }}>
          {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
        </select>

        <button onClick={() => setLines([])}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm"
          style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
          <Trash2 size={13} /> Clear
        </button>

        {streaming ? (
          <button onClick={stop}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium"
            style={{ backgroundColor: 'color-mix(in srgb, var(--danger) 15%, transparent)', color: 'var(--danger)', border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)' }}>
            <StopCircle size={13} /> Stop
          </button>
        ) : (
          <button onClick={start}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium"
            style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 15%, transparent)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)' }}>
            <Play size={13} /> Stream
          </button>
        )}
      </div>

      <div className="flex-1 rounded-xl overflow-y-auto font-mono text-xs p-3 min-h-0"
        style={{ backgroundColor: '#0f0f0f', border: '1px solid var(--border)' }}>
        {lines.length === 0 && !streaming && (
          <p className="text-center pt-8" style={{ color: '#666' }}>
            Select a service and click Stream to tail logs
          </p>
        )}
        {streaming && lines.length === 0 && (
          <div className="flex items-center gap-2 pt-8 justify-center">
            <Loader2 size={14} className="animate-spin" style={{ color: '#666' }} />
            <span style={{ color: '#666' }}>Waiting for logs…</span>
          </div>
        )}
        {lines.map((line, i) => (
          <div key={i} className="flex gap-2 leading-5">
            <span style={{ color: '#555', flexShrink: 0 }}>{new Date(line.ts).toLocaleTimeString()}</span>
            <span style={{ color: levelColor(line.level), flexShrink: 0, width: 36 }}>{line.level.toUpperCase().slice(0, 4)}</span>
            <span style={{ color: '#888', flexShrink: 0 }}>[{line.service}]</span>
            <span style={{ color: '#e5e5e5', wordBreak: 'break-all' }}>{line.message}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
