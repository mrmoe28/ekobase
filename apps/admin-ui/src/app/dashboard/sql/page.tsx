'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Play, Trash2, Clock, ChevronDown, ChevronRight, Terminal, Loader2 } from 'lucide-react'
import { executeSql, type QueryResult } from '@/lib/api'

const HISTORY_KEY = 'sql_query_history'
const MAX_HISTORY = 30

type HistoryEntry = {
  id: string
  query: string
  timestamp: number
  success: boolean
  rowCount: number | null
}

function loadHistory(): HistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]')
  } catch {
    return []
  }
}

function saveHistory(entries: HistoryEntry[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, MAX_HISTORY)))
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function cellValue(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export default function SqlEditorPage() {
  const [query, setQuery] = useState('SELECT * FROM auth.users LIMIT 10;')
  const [result, setResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setHistory(loadHistory())
  }, [])

  const runQuery = useCallback(async () => {
    if (!query.trim() || running) return
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      const res = await executeSql(query.trim())
      setResult(res)
      const entry: HistoryEntry = {
        id: crypto.randomUUID(),
        query: query.trim(),
        timestamp: Date.now(),
        success: true,
        rowCount: res.rowCount,
      }
      setHistory(prev => {
        const next = [entry, ...prev]
        saveHistory(next)
        return next
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Query failed'
      setError(msg)
      const entry: HistoryEntry = {
        id: crypto.randomUUID(),
        query: query.trim(),
        timestamp: Date.now(),
        success: false,
        rowCount: null,
      }
      setHistory(prev => {
        const next = [entry, ...prev]
        saveHistory(next)
        return next
      })
    } finally {
      setRunning(false)
    }
  }, [query, running])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      const ta = e.currentTarget
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const next = query.substring(0, start) + '  ' + query.substring(end)
      setQuery(next)
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2
      })
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      runQuery()
    }
  }

  const clearHistory = () => {
    setHistory([])
    localStorage.removeItem(HISTORY_KEY)
  }

  const columns = result?.fields ? result.fields.map(f => f.name) : []

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 15%, transparent)' }}>
          <Terminal size={16} style={{ color: 'var(--accent)' }} />
        </div>
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text)' }}>SQL Editor</h1>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Run queries against your database · Ctrl+Enter to execute
          </p>
        </div>
      </div>

      {/* Editor */}
      <div className="card" style={{ border: '1px solid var(--border)' }}>
        <textarea
          ref={textareaRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={10}
          spellCheck={false}
          className="w-full p-4 text-sm font-mono resize-y bg-transparent outline-none"
          style={{ color: 'var(--text)', borderBottom: '1px solid var(--border)', minHeight: '160px' }}
          placeholder="SELECT * FROM auth.users LIMIT 10;"
        />
        <div className="flex items-center justify-between px-4 py-2.5">
          <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
            {query.trim().split('\n').length} line{query.trim().split('\n').length !== 1 ? 's' : ''}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setQuery(''); setResult(null); setError(null) }}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors duration-150"
              style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}
            >
              Clear
            </button>
            <button
              onClick={runQuery}
              disabled={running || !query.trim()}
              className="btn-primary px-4 py-1.5 text-xs"
            >
              {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
              {running ? 'Running…' : 'Run'}
            </button>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="card p-4 text-sm font-mono"
          style={{ border: '1px solid color-mix(in srgb, var(--danger) 40%, transparent)', color: 'var(--danger)', backgroundColor: 'color-mix(in srgb, var(--danger) 6%, transparent)', whiteSpace: 'pre-wrap' }}>
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="card" style={{ border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between px-4 py-2.5"
            style={{ borderBottom: '1px solid var(--border)' }}>
            <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
              {result.command} ·{' '}
              {result.rows?.length > 0
                ? `${result.rows.length} row${result.rows.length !== 1 ? 's' : ''}`
                : result.rowCount != null
                ? `${result.rowCount} row${result.rowCount !== 1 ? 's' : ''} affected`
                : 'OK'}
            </span>
          </div>
          {result.rows?.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {columns.map(col => (
                      <th key={col} className="px-4 py-2 text-left font-semibold tracking-wide whitespace-nowrap"
                        style={{ color: 'var(--text-muted)', backgroundColor: 'var(--bg)' }}>
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows?.map((row, ri) => (
                    <tr key={ri} style={{ borderBottom: '1px solid var(--border)' }}>
                      {columns.map(col => {
                        const v = row[col]
                        const isNull = v === null || v === undefined
                        return (
                          <td key={col} className="px-4 py-2 max-w-xs truncate"
                            style={{ color: isNull ? 'var(--text-muted)' : 'var(--text)' }}
                            title={cellValue(v)}>
                            {isNull ? <em>NULL</em> : cellValue(v)}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-4 py-6 text-sm text-center" style={{ color: 'var(--text-muted)' }}>
              No rows returned
            </p>
          )}
        </div>
      )}

      {/* Query history */}
      <div className="card" style={{ border: '1px solid var(--border)' }}>
        <button
          onClick={() => setHistoryOpen(o => !o)}
          className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium text-left"
          style={{ color: 'var(--text)' }}>
          <Clock size={15} style={{ color: 'var(--text-muted)' }} />
          Query history
          <span className="text-xs ml-1" style={{ color: 'var(--text-muted)' }}>({history.length})</span>
          <span className="ml-auto" style={{ color: 'var(--text-muted)' }}>
            {historyOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </span>
        </button>

        {historyOpen && (
          <div style={{ borderTop: '1px solid var(--border)' }}>
            {history.length === 0 ? (
              <p className="px-4 py-4 text-sm text-center" style={{ color: 'var(--text-muted)' }}>
                No history yet
              </p>
            ) : (
              <>
                <div className="flex justify-end px-4 py-2">
                  <button onClick={clearHistory}
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded"
                    style={{ color: 'var(--danger)' }}>
                    <Trash2 size={12} /> Clear all
                  </button>
                </div>
                <div className="divide-y" style={{ maxHeight: '320px', overflowY: 'auto', borderColor: 'var(--border)' }}>
                  {history.map(entry => (
                    <button
                      key={entry.id}
                      onClick={() => { setQuery(entry.query); setResult(null); setError(null) }}
                      className="w-full text-left px-4 py-2.5 transition-colors duration-100"
                      style={{ backgroundColor: 'transparent' }}
                      onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'color-mix(in srgb, var(--border) 40%, transparent)' }}
                      onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent' }}>
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: entry.success ? 'var(--accent)' : 'var(--danger)' }} />
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {formatDate(entry.timestamp)} {formatTime(entry.timestamp)}
                          {entry.rowCount != null && ` · ${entry.rowCount} rows`}
                        </span>
                      </div>
                      <p className="text-xs font-mono truncate" style={{ color: 'var(--text)' }}>
                        {entry.query}
                      </p>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
