'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, Eye, EyeOff, Loader2, Copy, Check } from 'lucide-react'
import { getToken, setToken } from '@/lib/auth'

type View = 'signin' | 'signup' | 'forgot' | 'forgot-success'

export default function LoginPage() {
  const router = useRouter()
  const [view, setView] = useState<View>('signin')
  const [resetToken, setResetToken] = useState('')
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    if (getToken()) {
      router.replace('/dashboard')
    } else {
      setChecking(false)
    }
  }, [router])

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--bg)' }}>
        <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent)' }} />
      </div>
    )
  }

  const handleForgotSuccess = (token: string) => {
    setResetToken(token)
    setView('forgot-success')
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
            Admin Dashboard
          </h1>
        </div>

        {view === 'signin' && (
          <SignInForm
            onForgot={() => setView('forgot')}
            onSignUp={() => setView('signup')}
            router={router}
          />
        )}
        {view === 'signup' && (
          <SignUpForm onSignIn={() => setView('signin')} router={router} />
        )}
        {view === 'forgot' && (
          <ForgotForm onBack={() => setView('signin')} onSuccess={handleForgotSuccess} />
        )}
        {view === 'forgot-success' && (
          <ForgotSuccess token={resetToken} onBack={() => setView('signin')} />
        )}
      </div>
    </main>
  )
}

// ── Sign In ───────────────────────────────────────────────────────────────────

function SignInForm({
  onForgot,
  onSignUp,
  router,
}: {
  onForgot: () => void
  onSignUp: () => void
  router: ReturnType<typeof useRouter>
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!email.trim() || !password) {
      setError('Email and password are required.')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/token?grant_type=password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.msg ?? 'Invalid email or password.')
        setLoading(false)
        return
      }
      setToken(data.access_token)
      router.replace('/dashboard')
    } catch {
      setError('Could not reach the server.')
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-center -mt-2 mb-2" style={{ color: 'var(--text-muted)' }}>
        Sign in to your account
      </p>
      <div>
        <label htmlFor="si-email" className="label">Email</label>
        <input
          id="si-email" type="email" className="input-field" placeholder="you@example.com"
          value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" autoFocus
        />
      </div>
      <div>
        <label htmlFor="si-password" className="label">Password</label>
        <PasswordInput
          id="si-password" value={password} onChange={setPassword}
          show={showPassword} onToggle={() => setShowPassword(v => !v)}
        />
      </div>
      {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
      <button type="submit" className="btn-primary w-full justify-center py-2.5" disabled={loading}>
        {loading && <Loader2 size={16} className="animate-spin" />}
        {loading ? 'Signing in…' : 'Sign in'}
      </button>
      <div className="flex items-center justify-between pt-1">
        <button
          type="button" onClick={onForgot}
          className="text-sm transition-colors duration-150" style={{ color: 'var(--accent)' }}
        >
          Forgot password?
        </button>
        <button
          type="button" onClick={onSignUp}
          className="text-sm transition-colors duration-150" style={{ color: 'var(--accent)' }}
        >
          Create account
        </button>
      </div>
    </form>
  )
}

// ── Sign Up ───────────────────────────────────────────────────────────────────

function SignUpForm({
  onSignIn,
  router,
}: {
  onSignIn: () => void
  router: ReturnType<typeof useRouter>
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!email.trim() || !password) { setError('Email and password are required.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.msg ?? 'Could not create account.')
        setLoading(false)
        return
      }
      setToken(data.access_token)
      router.replace('/dashboard')
    } catch {
      setError('Could not reach the server.')
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-center -mt-2 mb-2" style={{ color: 'var(--text-muted)' }}>
        Create a new account
      </p>
      <div>
        <label htmlFor="su-email" className="label">Email</label>
        <input
          id="su-email" type="email" className="input-field" placeholder="you@example.com"
          value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" autoFocus
        />
      </div>
      <div>
        <label htmlFor="su-password" className="label">Password</label>
        <PasswordInput
          id="su-password" value={password} onChange={setPassword}
          show={showPassword} onToggle={() => setShowPassword(v => !v)}
        />
      </div>
      <div>
        <label htmlFor="su-confirm" className="label">Confirm password</label>
        <PasswordInput
          id="su-confirm" value={confirm} onChange={setConfirm}
          show={showPassword} onToggle={() => setShowPassword(v => !v)}
        />
      </div>
      {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
      <button type="submit" className="btn-primary w-full justify-center py-2.5" disabled={loading}>
        {loading && <Loader2 size={16} className="animate-spin" />}
        {loading ? 'Creating account…' : 'Create account'}
      </button>
      <p className="text-sm text-center pt-1" style={{ color: 'var(--text-muted)' }}>
        Already have an account?{' '}
        <button type="button" onClick={onSignIn} style={{ color: 'var(--accent)' }}>
          Sign in
        </button>
      </p>
    </form>
  )
}

// ── Forgot Password ───────────────────────────────────────────────────────────

function ForgotForm({
  onBack,
  onSuccess,
}: {
  onBack: () => void
  onSuccess: (token: string) => void
}) {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!email.trim()) { setError('Email is required.'); return }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.msg ?? 'Something went wrong.')
        setLoading(false)
        return
      }
      onSuccess(data.reset_token ?? '')
    } catch {
      setError('Could not reach the server.')
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-center -mt-2 mb-2" style={{ color: 'var(--text-muted)' }}>
        Enter your email and we&apos;ll generate a reset link.
      </p>
      <div>
        <label htmlFor="fp-email" className="label">Email</label>
        <input
          id="fp-email" type="email" className="input-field" placeholder="you@example.com"
          value={email} onChange={e => setEmail(e.target.value)} autoFocus
        />
      </div>
      {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
      <button type="submit" className="btn-primary w-full justify-center py-2.5" disabled={loading}>
        {loading && <Loader2 size={16} className="animate-spin" />}
        {loading ? 'Generating…' : 'Send reset link'}
      </button>
      <p className="text-sm text-center pt-1" style={{ color: 'var(--text-muted)' }}>
        <button type="button" onClick={onBack} style={{ color: 'var(--accent)' }}>
          Back to sign in
        </button>
      </p>
    </form>
  )
}

function ForgotSuccess({ token, onBack }: { token: string; onBack: () => void }) {
  const [copied, setCopied] = useState(false)
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:54326'
  const resetUrl = token ? `${origin}/reset-password?token=${token}` : ''

  const copy = async () => {
    await navigator.clipboard.writeText(resetUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-center -mt-2" style={{ color: 'var(--text-muted)' }}>
        {token
          ? <>Reset link generated. It expires in <strong style={{ color: 'var(--text)' }}>1 hour</strong>.</>
          : 'If that email is registered, a reset link has been generated.'}
      </p>
      {resetUrl && (
        <>
          <div
            className="rounded-xl p-3 text-xs font-mono break-all"
            style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
          >
            {resetUrl}
          </div>
          <div className="flex gap-2">
            <a
              href={resetUrl}
              className="btn-primary flex-1 justify-center py-2"
              style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              Reset password
            </a>
            <button
              type="button" onClick={copy}
              className="px-3 rounded-xl transition-colors duration-150"
              style={{
                backgroundColor: 'var(--bg)',
                border: '1px solid var(--border)',
                color: copied ? 'var(--accent)' : 'var(--text-muted)',
              }}
              title="Copy link"
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </button>
          </div>
        </>
      )}
      <p className="text-sm text-center" style={{ color: 'var(--text-muted)' }}>
        <button type="button" onClick={onBack} style={{ color: 'var(--accent)' }}>
          Back to sign in
        </button>
      </p>
    </div>
  )
}

// ── Shared ────────────────────────────────────────────────────────────────────

function PasswordInput({
  id,
  value,
  onChange,
  show,
  onToggle,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  show: boolean
  onToggle: () => void
}) {
  return (
    <div className="relative">
      <input
        id={id} type={show ? 'text' : 'password'} className="input-field pr-10"
        placeholder="••••••••" value={value} onChange={e => onChange(e.target.value)} autoComplete="off"
      />
      <button
        type="button" onClick={onToggle}
        className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors duration-150"
        style={{ color: 'var(--text-muted)' }}
        onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)' }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}
        aria-label={show ? 'Hide password' : 'Show password'}
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  )
}
