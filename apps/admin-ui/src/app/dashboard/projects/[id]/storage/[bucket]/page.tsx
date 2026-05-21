'use client'

import { useEffect, useRef, useState, type DragEvent } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Upload,
  Download,
  Trash2,
  Loader2,
  File as FileIcon,
  FileText,
  Image as ImageIcon,
  X,
} from 'lucide-react'
import {
  listBucketFiles,
  uploadBucketFile,
  downloadBucketFile,
  deleteBucketFile,
  type StorageFile,
} from '@/lib/api'
import Modal from '@/components/Modal'
import Toast, { type ToastType } from '@/components/Toast'

interface ToastState { message: string; type: ToastType; id: number }

const PREVIEW_MAX_BYTES = 2 * 1024 * 1024 // 2 MB
const TEXT_PREVIEW_BYTES = 64 * 1024 // 64 KB

function isImage(mime: string) {
  return mime.startsWith('image/')
}

function isText(mime: string) {
  return (
    mime.startsWith('text/') ||
    mime.endsWith('+json') ||
    mime === 'application/json' ||
    mime === 'application/xml' ||
    mime === 'application/javascript'
  )
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function FileIconFor({ mime }: { mime: string }) {
  if (isImage(mime)) return <ImageIcon size={16} style={{ color: 'var(--text-muted)' }} />
  if (isText(mime)) return <FileText size={16} style={{ color: 'var(--text-muted)' }} />
  return <FileIcon size={16} style={{ color: 'var(--text-muted)' }} />
}

export default function BucketFilesPage() {
  const { id, bucket } = useParams<{ id: string; bucket: string }>()
  const bucketName = decodeURIComponent(bucket)
  const router = useRouter()

  const [files, setFiles] = useState<StorageFile[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<StorageFile | null>(null)
  const [preview, setPreview] = useState<{ kind: 'image'; url: string } | { kind: 'text'; text: string; truncated: boolean } | { kind: 'unsupported' } | { kind: 'too-large' } | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<StorageFile | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const previewUrlRef = useRef<string | null>(null)

  const showToast = (message: string, type: ToastType) =>
    setToast({ message, type, id: Date.now() })

  useEffect(() => {
    listBucketFiles(id, bucketName)
      .then(setFiles)
      .catch((err: unknown) =>
        showToast(err instanceof Error ? err.message : 'Failed to load files', 'error'),
      )
      .finally(() => setLoading(false))
  }, [id, bucketName])

  // Revoke blob URLs on cleanup to avoid memory leaks.
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    }
  }, [])

  const openPreview = async (file: StorageFile) => {
    setSelected(file)
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = null
    }
    setPreview(null)
    if (file.size > PREVIEW_MAX_BYTES) {
      setPreview({ kind: 'too-large' })
      return
    }
    const mime = file.content_type || ''
    if (!isImage(mime) && !isText(mime)) {
      setPreview({ kind: 'unsupported' })
      return
    }
    setPreviewLoading(true)
    try {
      const blob = await downloadBucketFile(id, bucketName, file.name)
      if (isImage(mime)) {
        const url = URL.createObjectURL(blob)
        previewUrlRef.current = url
        setPreview({ kind: 'image', url })
      } else {
        const slice = blob.slice(0, TEXT_PREVIEW_BYTES)
        const text = await slice.text()
        setPreview({ kind: 'text', text, truncated: blob.size > TEXT_PREVIEW_BYTES })
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to load preview', 'error')
      setPreview({ kind: 'unsupported' })
    } finally {
      setPreviewLoading(false)
    }
  }

  const closePreview = () => {
    setSelected(null)
    setPreview(null)
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = null
    }
  }

  const handleDownload = async (file: StorageFile) => {
    try {
      const blob = await downloadBucketFile(id, bucketName, file.name)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = file.name
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Download failed', 'error')
    }
  }

  const uploadFiles = async (rawFiles: FileList | File[]) => {
    const list = Array.from(rawFiles)
    if (list.length === 0) return
    setUploading(true)
    try {
      const uploaded: StorageFile[] = []
      for (const f of list) {
        const result = await uploadBucketFile(id, bucketName, f.name, f)
        uploaded.push(result)
      }
      setFiles((prev) => {
        const seen = new Set(uploaded.map((u) => u.name))
        return [...uploaded, ...prev.filter((p) => !seen.has(p.name))]
      })
      showToast(`Uploaded ${list.length} file${list.length === 1 ? '' : 's'}`, 'success')
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Upload failed', 'error')
    } finally {
      setUploading(false)
    }
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files.length > 0) {
      uploadFiles(e.dataTransfer.files)
    }
  }

  const handleDelete = async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteBucketFile(id, bucketName, confirmDelete.name)
      setFiles((prev) => prev.filter((f) => f.id !== confirmDelete.id))
      if (selected?.id === confirmDelete.id) closePreview()
      setConfirmDelete(null)
      showToast('File deleted', 'success')
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Delete failed', 'error')
    } finally {
      setDeleting(false)
    }
  }

  const hasPreview = selected !== null

  return (
    <div className="space-y-6" style={{ maxWidth: hasPreview ? '100%' : '64rem' }}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => router.push(`/dashboard/projects/${id}/storage`)}
            className="p-1.5 rounded-lg shrink-0"
            style={{ color: 'var(--text-muted)' }}
            title="Back to buckets"
          >
            <ArrowLeft size={16} />
          </button>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold truncate" style={{ color: 'var(--text)' }}>
              {bucketName}
            </h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {files.length} {files.length === 1 ? 'file' : 'files'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) uploadFiles(e.target.files)
              if (fileInputRef.current) fileInputRef.current.value = ''
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="btn-primary px-3 py-2 flex items-center gap-2"
          >
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            Upload
          </button>
        </div>
      </div>

      <div className={`grid gap-4 ${hasPreview ? 'grid-cols-1 lg:grid-cols-[1fr_28rem]' : 'grid-cols-1'}`}>
        <div
          className="card p-3"
          style={{
            border: dragOver
              ? '2px dashed var(--accent)'
              : '1px solid var(--border)',
            backgroundColor: dragOver
              ? 'color-mix(in srgb, var(--accent) 6%, transparent)'
              : undefined,
          }}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          {loading ? (
            <div className="space-y-2 p-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="skeleton h-12 w-full" />
              ))}
            </div>
          ) : files.length === 0 ? (
            <div className="text-center py-16">
              <Upload size={28} className="mx-auto mb-2" style={{ color: 'var(--text-muted)' }} />
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Drop files here or use the Upload button
              </p>
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {files.map((f) => {
                const isSelected = selected?.id === f.id
                return (
                  <div
                    key={f.id}
                    className="flex items-center justify-between py-2.5 px-2 rounded-lg transition-colors cursor-pointer"
                    style={{
                      backgroundColor: isSelected
                        ? 'color-mix(in srgb, var(--accent) 10%, transparent)'
                        : 'transparent',
                    }}
                    onClick={() => openPreview(f)}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <FileIconFor mime={f.content_type || ''} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: 'var(--text)' }}>
                          {f.name}
                        </p>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {formatBytes(f.size)} · {f.content_type || 'unknown'} · {formatDate(f.created_at)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDownload(f)
                        }}
                        className="p-1.5 rounded-lg transition-colors"
                        style={{ color: 'var(--text-muted)' }}
                        title="Download"
                      >
                        <Download size={14} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setConfirmDelete(f)
                        }}
                        className="p-1.5 rounded-lg transition-colors"
                        style={{ color: 'var(--text-muted)' }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.color = 'var(--danger)'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.color = 'var(--text-muted)'
                        }}
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {hasPreview && selected && (
          <div className="card p-4 sticky top-4 h-fit" style={{ border: '1px solid var(--border)' }}>
            <div className="flex items-start justify-between mb-3 gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate" style={{ color: 'var(--text)' }}>
                  {selected.name}
                </p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {formatBytes(selected.size)} · {selected.content_type || 'unknown'}
                </p>
              </div>
              <button
                onClick={closePreview}
                className="p-1 rounded-lg shrink-0"
                style={{ color: 'var(--text-muted)' }}
                title="Close preview"
              >
                <X size={14} />
              </button>
            </div>

            <div
              className="rounded-lg overflow-hidden"
              style={{
                backgroundColor: 'var(--bg)',
                border: '1px solid var(--border)',
                maxHeight: '60vh',
              }}
            >
              {previewLoading ? (
                <div className="flex items-center justify-center p-8">
                  <Loader2 size={18} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
                </div>
              ) : preview?.kind === 'image' ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={preview.url}
                  alt={selected.name}
                  className="w-full h-auto"
                  style={{ maxHeight: '60vh', objectFit: 'contain' }}
                />
              ) : preview?.kind === 'text' ? (
                <pre
                  className="text-xs p-3 font-mono whitespace-pre-wrap break-words"
                  style={{ color: 'var(--text)', maxHeight: '60vh', overflowY: 'auto' }}
                >
                  {preview.text}
                  {preview.truncated && (
                    <span style={{ color: 'var(--text-muted)' }}>
                      {'\n\n--- truncated; download for full file ---'}
                    </span>
                  )}
                </pre>
              ) : preview?.kind === 'too-large' ? (
                <div className="p-8 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                  File is larger than 2 MB. Download to view.
                </div>
              ) : (
                <div className="p-8 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                  Preview not available for this file type.
                </div>
              )}
            </div>

            <div className="flex gap-2 mt-3">
              <button
                onClick={() => handleDownload(selected)}
                className="btn-secondary px-3 py-2 flex items-center gap-2 flex-1 justify-center"
              >
                <Download size={14} />
                Download
              </button>
              <button
                onClick={() => setConfirmDelete(selected)}
                className="px-3 py-2 rounded-xl flex items-center gap-2"
                style={{
                  border: '1px solid var(--border)',
                  color: 'var(--danger)',
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      <Modal isOpen={confirmDelete !== null} title="Delete file?" onClose={() => setConfirmDelete(null)}>
        {confirmDelete && (
          <div className="space-y-4">
            <p className="text-sm" style={{ color: 'var(--text)' }}>
              Delete <code className="font-mono">{confirmDelete.name}</code>? This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(null)} className="btn-secondary px-3 py-2" disabled={deleting}>
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-3 py-2 rounded-xl flex items-center gap-2 font-medium"
                style={{ backgroundColor: 'var(--danger)', color: 'white' }}
              >
                {deleting && <Loader2 size={14} className="animate-spin" />}
                Delete
              </button>
            </div>
          </div>
        )}
      </Modal>

      {toast && (
        <Toast key={toast.id} message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />
      )}
    </div>
  )
}
