import { getAccessToken, refreshAccessToken } from '@/lib/api'
import { idbAll, idbCount, idbDelete, idbGet, idbPut } from './db'
import { pendingSyncCount } from './state'

export const OFFLINE_QUEUED_HEADER = 'x-bookorbit-offline'
const OFFLINE_QUEUED_VALUE = 'queued'
const ID_MAP_KEY = 'id-map'
const SEQ_KEY = 'queue-seq'
const PROGRESS_URL_PATTERN = /\/api\/v1\/books\/files\/\d+\/progress$/
const TEMP_ID_URL_PATTERN = /\/(annotations|bookmarks)\/(-?\d+)/

export interface QueuedMutation {
  id: string
  url: string
  method: string
  headers: Record<string, string>
  body?: string
  /** Negative local id of the created resource; mapped to the real server id on flush. */
  tempId?: number
  /** Monotonic enqueue order - IndexedDB keys are UUIDs, so rows must be sorted by this. */
  seq: number
  createdAt: number
}

export interface ReconciledMutation {
  tempId: number
  realId: number
  url: string
  data: unknown
}

/** Negative, monotonic-ish local id used for resources created while offline. */
export function makeTempId(): number {
  return -Math.abs(Date.now())
}

export function isQueuedResponse(res: Response): boolean {
  // Defensive: some tests/callers pass plain response-like objects without headers.
  return res.headers?.get?.(OFFLINE_QUEUED_HEADER) === OFFLINE_QUEUED_VALUE
}

export function queuedResponse(): Response {
  return new Response(JSON.stringify({ queued: true }), {
    status: 202,
    headers: { 'Content-Type': 'application/json', [OFFLINE_QUEUED_HEADER]: OFFLINE_QUEUED_VALUE },
  })
}

export function unavailableResponse(): Response {
  return new Response(null, { status: 503 })
}

export async function refreshPendingSyncCount(): Promise<void> {
  pendingSyncCount.value = await idbCount('queue')
}

export async function countPendingSync(): Promise<number> {
  return idbCount('queue')
}

export async function enqueueMutation(url: string, init: RequestInit, tempId?: number): Promise<Response> {
  try {
    const headers = new Headers(init.headers)
    const prevSeq = await idbGet<number>('kv', SEQ_KEY)
    const entry: QueuedMutation = {
      id:
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `m-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      url,
      method: (init.method ?? 'POST').toUpperCase(),
      headers: Object.fromEntries(headers.entries()),
      body: typeof init.body === 'string' ? init.body : undefined,
      tempId,
      seq: (prevSeq ?? 0) + 1,
      createdAt: Date.now(),
    }
    await idbPut('queue', entry)
    await idbPut('kv', entry.seq, SEQ_KEY)
    await refreshPendingSyncCount()
  } catch {
    // Offline storage unavailable: fall back to the real request so nothing silently drops.
    return fetch(url, init)
  }
  return queuedResponse()
}

/**
 * Reading progress is write-heavy and only the latest value matters, so before
 * replaying the queue keep only the most recent progress POST per file.
 */
function coalesceProgress(entries: QueuedMutation[]): QueuedMutation[] {
  const ordered = [...entries].sort((a, b) => a.seq - b.seq)
  const latest = new Map<string, QueuedMutation>()
  const rest: QueuedMutation[] = []
  for (const entry of ordered) {
    if (entry.method === 'POST' && PROGRESS_URL_PATTERN.test(entry.url)) latest.set(entry.url, entry)
    else rest.push(entry)
  }
  return [...rest, ...latest.values()]
}

/** Rewrites DELETE/PATCH urls that still carry a temp id once the real id is known. */
function rewriteTempId(url: string, idMap: Record<number, number>): string {
  return url.replace(TEMP_ID_URL_PATTERN, (_match, kind: string, rawId: string) => {
    const numeric = Number(rawId)
    const real = numeric < 0 ? idMap[numeric] : undefined
    return real !== undefined ? `/${kind}/${real}` : `/${kind}/${rawId}`
  })
}

export async function flushQueue(): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return
  const allEntries = await idbAll<QueuedMutation>('queue')
  if (allEntries.length === 0) return
  const entries = coalesceProgress(allEntries)

  // Rows dropped by coalescing are superseded progress posts - delete them so the
  // pending count reflects only what still needs to sync.
  const keptIds = new Set(entries.map((entry) => entry.id))
  await Promise.all(allEntries.filter((entry) => !keptIds.has(entry.id)).map((entry) => idbDelete('queue', entry.id)))

  const idMap = (await idbGet<Record<number, number>>('kv', ID_MAP_KEY)) ?? {}
  const idMapChanges: Record<number, number> = {}
  const reconciled: ReconciledMutation[] = []
  let didRefresh = false

  // Mappings discovered earlier in this flush must apply to later entries too.
  const effectiveMap = (): Record<number, number> => ({ ...idMap, ...idMapChanges })

  for (const entry of entries) {
    let url = rewriteTempId(entry.url, effectiveMap())
    let res: Response
    try {
      res = await fetch(url, {
        method: entry.method,
        headers: { ...entry.headers, ...(getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : {}) },
        body: entry.body,
        credentials: 'include',
      })
    } catch {
      break // still offline - keep the queue and retry on the next flush
    }
    if (res.status === 401 && !didRefresh) {
      // Access token expired while offline - refresh once and retry this entry.
      try {
        await refreshAccessToken()
        didRefresh = true
        url = rewriteTempId(entry.url, effectiveMap())
        res = await fetch(url, {
          method: entry.method,
          headers: { ...entry.headers, ...(getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : {}) },
          body: entry.body,
          credentials: 'include',
        })
      } catch {
        break
      }
    }
    if (res.status === 401 || res.status >= 500) break // leave in the queue, retry later
    if (!res.ok) {
      await idbDelete('queue', entry.id) // permanent client error - drop
      continue
    }
    if (entry.tempId != null && entry.method === 'POST') {
      const data: unknown = await res.json().catch(() => null)
      const realId = (data as { id?: number } | null)?.id
      if (typeof realId === 'number') {
        idMapChanges[entry.tempId] = realId
        reconciled.push({ tempId: entry.tempId, realId, url, data })
      }
    }
    await idbDelete('queue', entry.id)
  }

  if (Object.keys(idMapChanges).length > 0) {
    await idbPut('kv', { ...idMap, ...idMapChanges }, ID_MAP_KEY)
  }
  await refreshPendingSyncCount()
  if (reconciled.length > 0 && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('bookorbit:offline-reconciled', { detail: { mutations: reconciled } }))
  }
}
