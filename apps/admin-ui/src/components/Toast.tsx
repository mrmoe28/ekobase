'use client'

import { useEffect, useState } from 'react'
import { CheckCircle, AlertCircle, X } from 'lucide-react'

export type ToastType = 'success' | 'error'

interface ToastProps {
  message: string
  type: ToastType
  onDismiss: () => void
}

export default function Toast({ message, type, onDismiss }: ToastProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // Trigger entrance animation
    const enterTimer = setTimeout(() => setVisible(true), 10)
    // Auto-dismiss after 3s
    const dismissTimer = setTimeout(() => {
      setVisible(false)
      setTimeout(onDismiss, 300)
    }, 3000)

    return () => {
      clearTimeout(enterTimer)
      clearTimeout(dismissTimer)
    }
  }, [onDismiss])

  const isSuccess = type === 'success'

  return (
    <div
      className="fixed bottom-6 right-6 z-[100] flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg transition-all duration-300"
      style={{
        backgroundColor: 'var(--surface)',
        border: `1px solid ${isSuccess ? 'color-mix(in srgb, var(--accent) 40%, transparent)' : 'color-mix(in srgb, var(--danger) 40%, transparent)'}`,
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(1rem)',
        minWidth: '260px',
        maxWidth: '380px',
      }}
      role="alert"
    >
      {isSuccess ? (
        <CheckCircle size={18} style={{ color: 'var(--accent)', flexShrink: 0 }} />
      ) : (
        <AlertCircle size={18} style={{ color: 'var(--danger)', flexShrink: 0 }} />
      )}
      <span
        className="flex-1 text-sm font-medium"
        style={{ color: 'var(--text)' }}
      >
        {message}
      </span>
      <button
        onClick={() => {
          setVisible(false)
          setTimeout(onDismiss, 300)
        }}
        className="p-0.5 rounded transition-colors duration-150"
        style={{ color: 'var(--text-muted)' }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--text)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--text-muted)'
        }}
        aria-label="Dismiss notification"
      >
        <X size={14} />
      </button>
    </div>
  )
}
