import type { RefreshResponse } from '@bookorbit/types'

const ACCESS_TOKEN_STORAGE_KEY = 'bookorbit:access-token'

let _accessToken: string | null = null
let _onAuthFailure: (() => void) | null = null
let _refreshPromise: Promise<string> | null = null

function readStoredAccessToken(): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY) : null
  } catch {
    return null
  }
}

// Hydrate the in-memory token from storage so an offline reload keeps the session.
// Persisting the access token widens XSS exposure versus the original in-memory-only
// token, but the refresh token stays in the httpOnly cookie, which keeps the long-lived
// credential protected. This is the standard tradeoff for offline PWA sessions.
if (typeof localStorage !== 'undefined') {
  _accessToken = readStoredAccessToken()
}

export function setAccessToken(token: string | null): void {
  _accessToken = token
  try {
    if (typeof localStorage !== 'undefined') {
      if (token) localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, token)
      else localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY)
    }
  } catch {
    // Storage unavailable - keep the token in memory only.
  }
}

export function getAccessToken(): string | null {
  return _accessToken
}

/** Returns the in-memory token, falling back to the persisted copy (used for offline boot). */
export function getStoredAccessToken(): string | null {
  return _accessToken ?? readStoredAccessToken()
}

export function setOnAuthFailure(fn: () => void): void {
  _onAuthFailure = fn
}

function rawFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  if (_accessToken) headers.set('Authorization', `Bearer ${_accessToken}`)
  return fetch(input, { ...init, headers, credentials: 'include' })
}

async function attemptRefresh(): Promise<string> {
  const res = await rawFetch('/api/v1/auth/refresh', { method: 'POST' })
  if (!res.ok) throw new Error('refresh failed')
  const data: RefreshResponse = await res.json()
  setAccessToken(data.accessToken)
  return data.accessToken
}

export async function refreshAccessToken(): Promise<string> {
  if (!_refreshPromise) {
    _refreshPromise = attemptRefresh().finally(() => {
      _refreshPromise = null
    })
  }
  return _refreshPromise
}

function isNetworkError(err: unknown): boolean {
  // Fetch rejects with a TypeError for network failures (AbortError is a DOMException).
  return err instanceof TypeError
}

/**
 * Offline fallback for requests that never reached the server:
 * - Mutations are queued in the offline outbox and replayed when back online.
 * - Reads return a 503 so existing `res.ok` checks degrade gracefully.
 */
async function handleNetworkFailure(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const method = (init?.method ?? 'GET').toUpperCase()
  const isMutation = method !== 'GET' && method !== 'HEAD'
  if (isMutation && url.startsWith('/api/') && !url.startsWith('/api/v1/auth/')) {
    const { enqueueMutation } = await import('@/lib/offline/queue')
    return enqueueMutation(url, init)
  }
  const { unavailableResponse } = await import('@/lib/offline/queue')
  return unavailableResponse()
}

export async function api(input: RequestInfo | URL, init?: RequestInit & { _isRetry?: boolean }): Promise<Response> {
  const isRetry = init?._isRetry
  const { _isRetry: _, ...rest } = init ?? {}
  let res: Response
  try {
    res = await rawFetch(input, rest)
  } catch (err) {
    if (isNetworkError(err)) return handleNetworkFailure(input, rest)
    throw err
  }

  if (res.status !== 401) return res

  if (isRetry) {
    _onAuthFailure?.()
    throw new Error('Session expired')
  }

  try {
    await refreshAccessToken()
  } catch {
    _onAuthFailure?.()
    throw new Error('Session expired')
  }

  return api(input, { ...rest, _isRetry: true })
}
