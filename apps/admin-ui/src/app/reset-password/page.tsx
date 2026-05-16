'use client'

import { useState, type FormEvent, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Sparkles, Eye, EyeOff, Loader2, CheckCircle } from 'lucide-react'

function ResetPasswordForm() {
  const router = useRouter()
  const params = useSearchParams()
  const token = params.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!password) { setError('Password is required.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return }
    if (!token) { setError('Missing reset token. Please use the link from the reset email.'); return }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.msg ?? 'Failed to reset password.')
        setLoading(false)
        return
      }
      setDone(true)
    } catch {
      setError('Could not reach the server.')
      setLoading(false)
    }
  }

  return (
    <main
      className="min-h-screen flex items-center justify-center p-4"
      style={{
        background:
          'radial-gradient(ellipse 80% 60% at 50% 0%, color-mix(in srgb, var(--accent) 12%, transparent), var(--bg) 70%)',
      }}
    >
      <div className="card w-full max-w-sm p-8" style={{ backgroundColor: 'var(--surface)' }}>
        <div className="flex flex-col items-center mb-6">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
            style={{
              background: 'linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 60%, #8B5CF6))',
            }}
          >
            <Sparkles size={26} className="text-white" />
          </div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--text)' }}>
            Set new password
          </h1>
        </div>

        {done ? (
          <div className="space-y-5 text-center">
            <CheckCircle size={40} className="mx-auto" style={{ color: 'var(--accent)' }} />
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Your password has been updated. You can now sign in.
            </p>
            <button
              type="button"
              className="btn-primary w-full justify-center py-2.5"
              onClick={() => router.replace('/')}
            >
              Go to sign in
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {!token && (
              <p className="text-sm rounded-xl px-3 py-2" style={{ color: 'var(--danger)', backgroundColor: 'color-mix(in srgb, var(--danger) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--danger) 25%, transparent)' }}>
                No reset token found. Please use the link from the reset page.
              </p>
            )}
            <div>
              <label htmlFor="rp-password" className="label">New password</label>
              <div className="relative">
                <input
                  id="rp-password"
                  type={showPassword ? 'text' : 'password'}
                  className="input-field pr-10"
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoFocus
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors duration-150"
                  style={{ color: 'var(--text-muted)' }}
                  onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)' }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <div>
              <label htmlFor="rp-confirm" className="label">Confirm password</label>
              <input
                id="rp-confirm"
                type={showPassword ? 'text' : 'password'}
                className="input-field"
                placeholder="••••••••"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
            <button
              type="submit"
              className="btn-primary w-full justify-center py-2.5"
              disabled={loading || !token}
            >
              {loading && <Loader2 size={16} className="animate-spin" />}
              {loading ? 'Updating…' : 'Update password'}
            </button>
            <p className="text-sm text-center pt-1" style={{ color: 'var(--text-muted)' }}>
              <a href="/" style={{ color: 'var(--accent)' }}>Back to sign in</a>
            </p>
          </form>
        )}
      </div>
    </main>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  )
}
