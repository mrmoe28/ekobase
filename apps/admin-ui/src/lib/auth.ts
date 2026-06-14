'use client'

const TOKEN_KEY = 'admin_token'

export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return sessionStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(TOKEN_KEY, token)
  } catch {
    // Ignore storage failures and let the caller continue without a persisted session.
  }
}

export function clearToken(): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    // Ignore storage failures.
  }
}
