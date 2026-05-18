'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import {
  ChevronRight, ChevronDown, Table2, Loader2,
  Trash2, Pencil, RefreshCw, ChevronLeft, Check, X,
} from 'lucide-react'
import {
  getSchemaTables, getTableRows, deleteTableRow, updateTableRow,
  type ColumnInfo, type TableData,
} from '@/lib/api'
import Modal from '@/components/Modal'
import Toast, { type ToastType } from '@/components/Toast'
import { useProject } from '@/contexts/project'

const PAGE_SIZE = 50

interface ToastState { message: string; type: ToastType; id: number }

function cellStr(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function CellDisplay({ v }: { v: unknown }) {
  if (v === null || v === undefined) {
    return <em style={{ color: 'var(--text-muted)' }}>NULL</em>
  }
  if (typeof v === 'boolean') return <span style={{ color: 'var(--accent)' }}>{String(v)}</span>
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  return <span className="truncate" title={s}>{s}</span>
}

export default function ProjectEditorPage() {
  const { id } = useParams<{ id: string }>()
  const project = useProject()
  const projectSchema = 'proj_' + id.replace(/-/g, '').slice(0, 16)

  const [tables, setTables] = useState<Record<string, ColumnInfo[]>>({})
  const [loadingSchema, setLoadingSchema] = useState(true)
  const [expandedSchema, setExpandedSchema] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)

  const [tableData, setTableData] = useState<TableData | null>(null)
  const [loadingData, setLoadingData] = useState(false)
  const [offset, setOffset] = useState(0)

  const [deletingRow, setDeletingRow] = useState<Record<string, unknown> | null>(null)
  const [editingRow, setEditingRow] = useState<Record<string, unknown> | null>(null)
  const [editForm, setEditForm] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const [toast, setToast] = useState<ToastState | null>(null)
  const showToast = (message: string, type: ToastType) =>
    setToast({ message, type, id: Date.now() })

  useEffect(() => {
    getSchemaTables()
      .then(map => setTables(map[projectSchema] ?? {}))
      .catch(() => showToast('Failed to load schema', 'error'))
      .finally(() => setLoadingSchema(false))
  }, [projectSchema])

  const loadRows = useCallback(async (table: string, off: number) => {
    setLoadingData(true)
    try {
      setTableData(await getTableRows(projectSchema, table, PAGE_SIZE, off))
    } catch {
      showToast('Failed to load rows', 'error')
    } finally {
      setLoadingData(false)
    }
  }, [projectSchema])

  const selectTable = (table: string) => {
    setSelected(table)
    setOffset(0)
    setTableData(null)
    loadRows(table, 0)
  }

  const goPage = (newOffset: number) => {
    if (!selected) return
    setOffset(newOffset)
    loadRows(selected, newOffset)
  }

  const columns = selected ? (tables[selected] ?? []) : []
  const pkCols = columns.filter(c => c.is_pk).map(c => c.column)
  const buildPk = (row: Record<string, unknown>) =>
    Object.fromEntries(pkCols.map(k => [k, row[k]]))

  const handleDelete = async (row: Record<string, unknown>) => {
    if (!selected || pkCols.length === 0) return
    setDeletingRow(row)
    try {
      await deleteTableRow(projectSchema, selected, buildPk(row))
      setTableData(prev =>
        prev ? { ...prev, rows: prev.rows.filter(r => r !== row), total: prev.total - 1 } : prev)
      showToast('Row deleted', 'success')
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to delete', 'error')
    } finally {
      setDeletingRow(null)
    }
  }

  const openEdit = (row: Record<string, unknown>) => {
    setEditingRow(row)
    setEditForm(Object.fromEntries(columns.map(c => [c.column, cellStr(row[c.column])])))
  }

  const handleSave = async () => {
    if (!selected || !editingRow) return
    setSaving(true)
    try {
      const pk = buildPk(editingRow)
      const data: Record<string, unknown> = {}
      for (const col of columns) {
        if (pkCols.includes(col.column)) continue
        const raw = editForm[col.column]
        data[col.column] = raw === '' ? null : raw
      }
      const updated = await updateTableRow(projectSchema, selected, pk, data)
      setTableData(prev =>
        prev ? { ...prev, rows: prev.rows.map(r => r === editingRow ? updated : r) } : prev)
      setEditingRow(null)
      showToast('Row updated', 'success')
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to update', 'error')
    } finally {
      setSaving(false)
    }
  }

  const total = tableData?.total ?? 0
  const totalPages = Math.ceil(total / PAGE_SIZE)
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1
  const tableNames = Object.keys(tables)

  return (
    <div
      className="flex -mx-5 -my-5 lg:-mx-6 lg:-my-6"
      style={{ height: 'calc(100% + 2.5rem)' }}
    >
      {/* Schema tree */}
      <aside className="w-52 shrink-0 overflow-y-auto border-r flex flex-col"
        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--sidebar-bg)' }}>
        <div className="px-3 py-2.5 border-b flex items-center gap-2"
          style={{ borderColor: 'var(--border)' }}>
          <Table2 size={14} style={{ color: 'var(--accent)' }} />
          <span className="text-xs font-semibold" style={{ color: 'var(--text)' }}>
            {project?.name ?? 'Tables'}
          </span>
          {loadingSchema && <Loader2 size={12} className="animate-spin ml-auto" style={{ color: 'var(--text-muted)' }} />}
        </div>

        <div className="py-1 flex-1">
          <button
            onClick={() => setExpandedSchema(v => !v)}
            className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider"
            style={{ color: 'var(--text-muted)' }}>
            {expandedSchema ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {projectSchema}
          </button>

          {expandedSchema && tableNames.map(table => {
            const active = selected === table
            return (
              <button
                key={table}
                onClick={() => selectTable(table)}
                className="w-full flex items-center gap-2 pl-7 pr-3 py-1.5 text-sm text-left transition-colors duration-100"
                style={{
                  backgroundColor: active
                    ? 'color-mix(in srgb, var(--accent) 15%, transparent)'
                    : 'transparent',
                  color: active ? 'var(--accent)' : 'var(--text)',
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.backgroundColor = 'color-mix(in srgb, var(--border) 50%, transparent)' }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.backgroundColor = 'transparent' }}>
                {table}
              </button>
            )
          })}

          {!loadingSchema && tableNames.length === 0 && (
            <p className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
              No tables in this schema yet.
            </p>
          )}
        </div>
      </aside>

      {/* Main panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-2">
              <Table2 size={36} style={{ color: 'var(--text-muted)', margin: '0 auto' }} />
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Select a table to browse its data</p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 px-4 py-2.5 border-b shrink-0"
              style={{ borderColor: 'var(--border)' }}>
              <span className="text-sm font-medium font-mono" style={{ color: 'var(--text)' }}>
                {projectSchema}.<strong>{selected}</strong>
              </span>
              {tableData && (
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {tableData.total} row{tableData.total !== 1 ? 's' : ''}
                </span>
              )}
              <button
                onClick={() => loadRows(selected, offset)}
                className="ml-auto p-1.5 rounded-lg"
                style={{ color: 'var(--text-muted)' }}>
                <RefreshCw size={14} />
              </button>
            </div>

            {columns.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-4 py-2 border-b shrink-0"
                style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)' }}>
                {columns.map(col => (
                  <span key={col.column}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono"
                    style={{ border: '1px solid var(--border)', color: col.is_pk ? 'var(--accent)' : 'var(--text-muted)' }}>
                    {col.is_pk && '🔑 '}
                    {col.column}
                    <span style={{ opacity: 0.6 }}>:{col.type}</span>
                    {!col.nullable && <span title="NOT NULL" style={{ color: 'var(--danger)' }}>*</span>}
                  </span>
                ))}
              </div>
            )}

            <div className="flex-1 overflow-auto">
              {loadingData ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 size={24} className="animate-spin" style={{ color: 'var(--accent)' }} />
                </div>
              ) : tableData && tableData.rows.length > 0 ? (
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      {tableData.fields.map(f => (
                        <th key={f.name}
                          className="px-3 py-2 text-left font-semibold whitespace-nowrap tracking-wide sticky top-0"
                          style={{ color: 'var(--text-muted)', backgroundColor: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
                          {f.name}
                        </th>
                      ))}
                      <th className="px-3 py-2 sticky top-0"
                        style={{ backgroundColor: 'var(--bg)', borderBottom: '1px solid var(--border)' }} />
                    </tr>
                  </thead>
                  <tbody>
                    {tableData.rows.map((row, ri) => {
                      const isDel = deletingRow === row
                      return (
                        <tr key={ri}
                          className="transition-colors duration-75"
                          style={{ borderBottom: '1px solid var(--border)' }}
                          onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'color-mix(in srgb, var(--border) 30%, transparent)' }}
                          onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent' }}>
                          {tableData.fields.map(f => (
                            <td key={f.name} className="px-3 py-2 max-w-[200px]"
                              style={{ color: 'var(--text)', fontFamily: 'monospace' }}>
                              <CellDisplay v={row[f.name]} />
                            </td>
                          ))}
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            {pkCols.length > 0 && (
                              <div className="flex items-center gap-1 justify-end">
                                <button onClick={() => openEdit(row)}
                                  className="p-1 rounded"
                                  style={{ color: 'var(--text-muted)' }}
                                  onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent)' }}
                                  onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}>
                                  <Pencil size={13} />
                                </button>
                                <button onClick={() => handleDelete(row)} disabled={isDel}
                                  className="p-1 rounded"
                                  style={{ color: 'var(--text-muted)' }}
                                  onMouseEnter={e => { e.currentTarget.style.color = 'var(--danger)' }}
                                  onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}>
                                  {isDel ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              ) : tableData ? (
                <div className="flex items-center justify-center h-32">
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No rows in this table</p>
                </div>
              ) : null}
            </div>

            {tableData && total > PAGE_SIZE && (
              <div className="flex items-center gap-3 px-4 py-2.5 border-t shrink-0"
                style={{ borderColor: 'var(--border)' }}>
                <button onClick={() => goPage(offset - PAGE_SIZE)} disabled={offset === 0}
                  className="p-1.5 rounded-lg disabled:opacity-40"
                  style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                  <ChevronLeft size={14} />
                </button>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Page {currentPage} of {totalPages}
                </span>
                <button onClick={() => goPage(offset + PAGE_SIZE)} disabled={offset + PAGE_SIZE >= total}
                  className="p-1.5 rounded-lg disabled:opacity-40"
                  style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                  <ChevronRight size={14} />
                </button>
                <span className="text-xs ml-auto" style={{ color: 'var(--text-muted)' }}>
                  {total} total rows
                </span>
              </div>
            )}
          </>
        )}
      </div>

      <Modal isOpen={!!editingRow} onClose={() => setEditingRow(null)} title="Edit row">
        {editingRow && (
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
            {columns.map(col => (
              <div key={col.column}>
                <label className="label flex items-center gap-1.5">
                  {col.column}
                  <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{col.type}</span>
                  {col.is_pk && <span className="text-xs px-1 rounded"
                    style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 15%, transparent)', color: 'var(--accent)' }}>PK</span>}
                </label>
                <input
                  className="input-field font-mono text-sm"
                  value={editForm[col.column] ?? ''}
                  onChange={e => setEditForm(prev => ({ ...prev, [col.column]: e.target.value }))}
                  disabled={col.is_pk}
                  placeholder={col.nullable ? 'NULL' : undefined}
                  style={col.is_pk ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
                />
              </div>
            ))}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setEditingRow(null)}
                className="px-4 py-2 rounded-xl text-sm font-medium"
                style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                <X size={14} className="inline mr-1" />Cancel
              </button>
              <button onClick={handleSave} disabled={saving} className="btn-primary">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {toast && <Toast key={toast.id} message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
    </div>
  )
}
