'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Database, Loader2, Plus, Trash2, RefreshCw } from 'lucide-react'
import {
  getSchemaTables, getTableRows, insertTableRow, deleteTableRow,
  type ColumnInfo, type TableData,
} from '@/lib/api'
import Modal from '@/components/Modal'
import Toast, { type ToastType } from '@/components/Toast'

interface ToastState { message: string; type: ToastType; id: number }
type Tab = 'schema' | 'rows'

const LIMIT = 50

export default function ProjectDatabasePage() {
  const { id } = useParams<{ id: string }>()
  const projectSchema = 'proj_' + id.replace(/-/g, '').slice(0, 16)

  const [tables, setTables] = useState<Record<string, ColumnInfo[]>>({})
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<Tab>('schema')
  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const [rowData, setRowData] = useState<TableData | null>(null)
  const [rowsLoading, setRowsLoading] = useState(false)
  const [offset, setOffset] = useState(0)
  const [showInsert, setShowInsert] = useState(false)
  const [insertValues, setInsertValues] = useState<Record<string, string>>({})
  const [inserting, setInserting] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)

  const showToast = (message: string, type: ToastType) =>
    setToast({ message, type, id: Date.now() })

  useEffect(() => {
    getSchemaTables()
      .then(map => {
        const schema = map[projectSchema] ?? {}
        setTables(schema)
        const first = Object.keys(schema)[0] ?? null
        setSelectedTable(first)
      })
      .finally(() => setLoading(false))
  }, [projectSchema])

  const loadRows = async (table: string, off = 0) => {
    setRowsLoading(true)
    try {
      const data = await getTableRows(projectSchema, table, LIMIT, off)
      setRowData(data)
      setOffset(off)
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to load rows', 'error')
    } finally {
      setRowsLoading(false)
    }
  }

  const switchTable = (table: string) => {
    setSelectedTable(table)
    setRowData(null)
    setOffset(0)
    if (activeTab === 'rows') loadRows(table, 0)
  }

  const switchTab = (tab: Tab) => {
    setActiveTab(tab)
    if (tab === 'rows' && selectedTable && !rowData) loadRows(selectedTable, 0)
  }

  const tableNames = Object.keys(tables)
  const cols = selectedTable ? (tables[selectedTable] ?? []) : []
  const pkCols = cols.filter(c => c.is_pk).map(c => c.column)

  const handleInsert = async () => {
    if (!selectedTable) return
    setInserting(true)
    try {
      const data: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(insertValues)) {
        if (v !== '') data[k] = v
      }
      await insertTableRow(projectSchema, selectedTable, data)
      showToast('Row inserted', 'success')
      setShowInsert(false)
      setInsertValues({})
      loadRows(selectedTable, offset)
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Insert failed', 'error')
    } finally {
      setInserting(false)
    }
  }

  const handleDelete = async (row: Record<string, unknown>) => {
    if (!selectedTable) return
    const pk: Record<string, unknown> = {}
    for (const col of pkCols) pk[col] = row[col]
    const key = JSON.stringify(pk)
    setDeleting(key)
    try {
      await deleteTableRow(projectSchema, selectedTable, pk)
      showToast('Row deleted', 'success')
      loadRows(selectedTable, offset)
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Delete failed', 'error')
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="max-w-full space-y-4">
      {toast && <Toast key={toast.id} message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}

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
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Use the SQL editor to create tables.</p>
        </div>
      ) : (
        <div className="flex gap-4">
          <div className="w-44 shrink-0 rounded-xl overflow-hidden"
            style={{ border: '1px solid var(--border)', backgroundColor: 'var(--surface)' }}>
            <p className="px-3 py-2 text-xs font-semibold border-b"
              style={{ color: 'var(--text-muted)', borderColor: 'var(--border)' }}>Tables</p>
            {tableNames.map(t => (
              <button key={t} onClick={() => switchTable(t)}
                className="w-full text-left px-3 py-2 text-xs font-mono truncate border-b"
                style={{
                  borderColor: 'var(--border)',
                  color: selectedTable === t ? 'var(--accent)' : 'var(--text)',
                  backgroundColor: selectedTable === t
                    ? 'color-mix(in srgb, var(--accent) 10%, transparent)'
                    : 'transparent',
                }}>
                {t}
              </button>
            ))}
          </div>

          <div className="flex-1 min-w-0 rounded-xl"
            style={{ border: '1px solid var(--border)', backgroundColor: 'var(--surface)' }}>
            <div className="flex border-b" style={{ borderColor: 'var(--border)' }}>
              {(['schema', 'rows'] as Tab[]).map(tab => (
                <button key={tab} onClick={() => switchTab(tab)}
                  className="px-4 py-2.5 text-sm font-medium capitalize"
                  style={{
                    color: activeTab === tab ? 'var(--accent)' : 'var(--text-muted)',
                    borderBottom: activeTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
                  }}>
                  {tab}
                </button>
              ))}
            </div>

            {activeTab === 'schema' && selectedTable && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ backgroundColor: 'var(--bg)' }}>
                      {['column', 'type', 'nullable', 'default', 'pk'].map(h => (
                        <th key={h} className="px-4 py-2 text-left font-semibold tracking-wide"
                          style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {cols.map(col => (
                      <tr key={col.column} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td className="px-4 py-2 font-mono font-medium"
                          style={{ color: col.is_pk ? 'var(--accent)' : 'var(--text)' }}>{col.column}</td>
                        <td className="px-4 py-2 font-mono" style={{ color: 'var(--text-muted)' }}>{col.type}</td>
                        <td className="px-4 py-2"
                          style={{ color: col.nullable ? 'var(--text-muted)' : 'var(--danger)' }}>
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
              </div>
            )}

            {activeTab === 'rows' && (
              <div>
                <div className="flex items-center gap-2 px-4 py-2.5 border-b" style={{ borderColor: 'var(--border)' }}>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {rowData ? `${rowData.total} total rows` : ''}
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    <button onClick={() => selectedTable && loadRows(selectedTable, offset)}
                      className="p-1.5 rounded-lg"
                      style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                      <RefreshCw size={13} />
                    </button>
                    <button onClick={() => { setInsertValues({}); setShowInsert(true) }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
                      style={{
                        backgroundColor: 'color-mix(in srgb, var(--accent) 15%, transparent)',
                        color: 'var(--accent)',
                        border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
                      }}>
                      <Plus size={12} /> Insert row
                    </button>
                  </div>
                </div>

                {rowsLoading ? (
                  <div className="flex items-center justify-center h-24">
                    <Loader2 size={18} className="animate-spin" style={{ color: 'var(--accent)' }} />
                  </div>
                ) : rowData && rowData.rows.length > 0 ? (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr style={{ backgroundColor: 'var(--bg)' }}>
                            {rowData.fields.map(f => (
                              <th key={f.name} className="px-3 py-2 text-left font-semibold whitespace-nowrap"
                                style={{
                                  color: pkCols.includes(f.name) ? 'var(--accent)' : 'var(--text-muted)',
                                  borderBottom: '1px solid var(--border)',
                                }}>
                                {f.name}
                              </th>
                            ))}
                            <th style={{ borderBottom: '1px solid var(--border)', width: 36 }} />
                          </tr>
                        </thead>
                        <tbody>
                          {rowData.rows.map((row, i) => {
                            const pk: Record<string, unknown> = {}
                            for (const c of pkCols) pk[c] = row[c]
                            const pkKey = JSON.stringify(pk)
                            return (
                              <tr key={pkKey + i} style={{ borderBottom: '1px solid var(--border)' }}>
                                {rowData.fields.map(f => (
                                  <td key={f.name} className="px-3 py-2 font-mono max-w-xs truncate"
                                    style={{ color: 'var(--text)' }}>
                                    {row[f.name] === null
                                      ? <em style={{ color: 'var(--text-muted)' }}>null</em>
                                      : String(row[f.name])}
                                  </td>
                                ))}
                                <td className="px-2 py-1">
                                  <button onClick={() => handleDelete(row)}
                                    disabled={deleting === pkKey || pkCols.length === 0}
                                    className="p-1 rounded"
                                    style={{ color: 'var(--text-muted)' }}
                                    onMouseEnter={e => { e.currentTarget.style.color = 'var(--danger)' }}
                                    onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}>
                                    {deleting === pkKey
                                      ? <Loader2 size={12} className="animate-spin" />
                                      : <Trash2 size={12} />}
                                  </button>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                    {rowData.total > LIMIT && (
                      <div className="flex items-center justify-between px-4 py-2 border-t"
                        style={{ borderColor: 'var(--border)' }}>
                        <button disabled={offset === 0}
                          onClick={() => selectedTable && loadRows(selectedTable, Math.max(0, offset - LIMIT))}
                          className="px-3 py-1 text-xs rounded-lg"
                          style={{ border: '1px solid var(--border)', color: 'var(--text-muted)', opacity: offset === 0 ? 0.4 : 1 }}>
                          Prev
                        </button>
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {offset + 1}–{Math.min(offset + LIMIT, rowData.total)} of {rowData.total}
                        </span>
                        <button disabled={offset + LIMIT >= rowData.total}
                          onClick={() => selectedTable && loadRows(selectedTable, offset + LIMIT)}
                          className="px-3 py-1 text-xs rounded-lg"
                          style={{ border: '1px solid var(--border)', color: 'var(--text-muted)', opacity: offset + LIMIT >= rowData.total ? 0.4 : 1 }}>
                          Next
                        </button>
                      </div>
                    )}
                  </>
                ) : rowData ? (
                  <p className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>
                    No rows in this table
                  </p>
                ) : (
                  <p className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>
                    Select a table above
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {showInsert && selectedTable && (
        <Modal isOpen={showInsert} title={`Insert row into ${selectedTable}`} onClose={() => setShowInsert(false)}>
          <div className="space-y-3">
            {cols.filter(c => !c.is_pk || !c.default).map(col => (
              <div key={col.column}>
                <label className="label">
                  {col.column}{' '}
                  <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>({col.type})</span>
                </label>
                <input
                  className="input-field"
                  placeholder={col.default ? `default: ${col.default}` : col.nullable ? 'null' : 'required'}
                  value={insertValues[col.column] ?? ''}
                  onChange={e => setInsertValues(prev => ({ ...prev, [col.column]: e.target.value }))}
                />
              </div>
            ))}
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowInsert(false)} className="btn-secondary">Cancel</button>
              <button onClick={handleInsert} disabled={inserting} className="btn-primary">
                {inserting ? <Loader2 size={14} className="animate-spin" /> : null}
                Insert
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
