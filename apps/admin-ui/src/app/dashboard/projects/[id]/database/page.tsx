'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Database, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { getSchemaTables, type ColumnInfo } from '@/lib/api'

export default function ProjectDatabasePage() {
  const { id } = useParams<{ id: string }>()
  const projectSchema = 'proj_' + id.replace(/-/g, '').slice(0, 16)

  const [tables, setTables] = useState<Record<string, ColumnInfo[]>>({})
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    getSchemaTables()
      .then(map => {
        const schema = map[projectSchema] ?? {}
        setTables(schema)
        setExpanded(new Set(Object.keys(schema).slice(0, 3)))
      })
      .finally(() => setLoading(false))
  }, [projectSchema])

  const tableNames = Object.keys(tables)

  const toggle = (table: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(table) ? next.delete(table) : next.add(table)
      return next
    })
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 15%, transparent)' }}>
          <Database size={16} style={{ color: 'var(--accent)' }} />
        </div>
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text)' }}>Database</h1>
          <p className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{projectSchema}</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 size={22} className="animate-spin" style={{ color: 'var(--accent)' }} />
        </div>
      ) : tableNames.length === 0 ? (
        <div className="card p-8 text-center" style={{ border: '1px solid var(--border)' }}>
          <Database size={32} className="mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            No tables in <code className="font-mono">{projectSchema}</code> yet.
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            Use the SQL editor to create tables in this project schema.
          </p>
        </div>
      ) : (
        <div className="card" style={{ border: '1px solid var(--border)' }}>
          <div className="px-4 py-2.5 border-b flex items-center justify-between"
            style={{ borderColor: 'var(--border)' }}>
            <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
              {tableNames.length} table{tableNames.length !== 1 ? 's' : ''}
            </span>
          </div>

          <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {tableNames.map(table => {
              const cols = tables[table]
              const isOpen = expanded.has(table)
              const pkCols = cols.filter(c => c.is_pk)
              return (
                <div key={table}>
                  <button
                    onClick={() => toggle(table)}
                    className="w-full flex items-center gap-2 px-4 py-3 text-left transition-colors duration-100"
                    style={{ color: 'var(--text)' }}
                    onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'color-mix(in srgb, var(--border) 30%, transparent)' }}
                    onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent' }}
                  >
                    {isOpen ? <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} /> : <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />}
                    <span className="text-sm font-medium font-mono">{table}</span>
                    <span className="text-xs ml-auto" style={{ color: 'var(--text-muted)' }}>
                      {cols.length} col{cols.length !== 1 ? 's' : ''}
                      {pkCols.length > 0 && ` · PK: ${pkCols.map(c => c.column).join(', ')}`}
                    </span>
                  </button>

                  {isOpen && (
                    <table className="w-full text-xs border-t" style={{ borderColor: 'var(--border)' }}>
                      <thead>
                        <tr style={{ backgroundColor: 'var(--bg)' }}>
                          {['column', 'type', 'nullable', 'default', 'pk'].map(h => (
                            <th key={h} className="px-4 py-1.5 text-left font-semibold tracking-wide"
                              style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {cols.map(col => (
                          <tr key={col.column} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td className="px-4 py-2 font-mono font-medium" style={{ color: col.is_pk ? 'var(--accent)' : 'var(--text)' }}>
                              {col.column}
                            </td>
                            <td className="px-4 py-2 font-mono" style={{ color: 'var(--text-muted)' }}>{col.type}</td>
                            <td className="px-4 py-2" style={{ color: col.nullable ? 'var(--text-muted)' : 'var(--danger)' }}>
                              {col.nullable ? 'yes' : 'no'}
                            </td>
                            <td className="px-4 py-2 font-mono" style={{ color: 'var(--text-muted)' }}>
                              {col.default ?? <em>—</em>}
                            </td>
                            <td className="px-4 py-2" style={{ color: 'var(--accent)' }}>
                              {col.is_pk ? '✓' : ''}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
