import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAccessToken, refreshAccessToken } from '@/lib/api'
import { idbCount, clearOfflineStores } from '../db'
import { enqueueMutation, flushQueue, isQueuedResponse, makeTempId } from '../queue'

vi.mock('@/lib/api', () => ({
  getAccessToken: vi.fn<() => string>(() => 'test-token'),
  refreshAccessToken: vi.fn<() => Promise<string>>(async () => 'fresh-token'),
}))

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('offline queue', () => {
  beforeEach(async () => {
    await clearOfflineStores()
    vi.stubGlobal('fetch', vi.fn())
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('enqueues a mutation and returns a queued response', async () => {
    const res = await enqueueMutation('/api/v1/books/1/annotations', { method: 'POST', body: '{}' })

    expect(res.status).toBe(202)
    expect(isQueuedResponse(res)).toBe(true)
    expect(await idbCount('queue')).toBe(1)
  })

  it('replays queued mutations in order and removes them', async () => {
    const fetchMock = vi.mocked(fetch)
    await enqueueMutation('/api/v1/books/1/annotations', { method: 'POST', body: '{"cfi":"x"}' })
    await enqueueMutation('/api/v1/books/1/annotations/5', { method: 'DELETE' })
    fetchMock.mockResolvedValue(jsonResponse({ id: 99 }))

    await flushQueue()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(await idbCount('queue')).toBe(0)
  })

  it('coalesces repeated progress posts down to the latest value', async () => {
    const fetchMock = vi.mocked(fetch)
    await enqueueMutation('/api/v1/books/files/7/progress', { method: 'POST', body: '{"percentage":10}' })
    await enqueueMutation('/api/v1/books/files/7/progress', { method: 'POST', body: '{"percentage":42}' })
    fetchMock.mockResolvedValue(jsonResponse({}))

    await flushQueue()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![1]?.body).toBe('{"percentage":42}')
    // The superseded progress row must be removed too, not just skipped.
    expect(await idbCount('queue')).toBe(0)
  })

  it('rewrites temp ids to real server ids for later mutations', async () => {
    const fetchMock = vi.mocked(fetch)
    const tempId = makeTempId()
    await enqueueMutation('/api/v1/books/1/annotations', { method: 'POST', body: '{}' }, tempId)
    await enqueueMutation(`/api/v1/books/1/annotations/${tempId}`, { method: 'DELETE' })
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      return url.includes('/annotations/') ? jsonResponse({}) : jsonResponse({ id: 123 })
    })

    await flushQueue()

    const deleteCall = fetchMock.mock.calls.find(([input]) => String(input).includes('/annotations/'))!
    expect(String(deleteCall[0])).toContain('/annotations/123')
  })

  it('drops permanent client errors but keeps the queue on server errors', async () => {
    const fetchMock = vi.mocked(fetch)
    await enqueueMutation('/api/v1/books/1/bookmarks', { method: 'POST', body: '{"cfi":"a"}' })
    await enqueueMutation('/api/v1/books/1/bookmarks', { method: 'POST', body: '{"cfi":"b"}' })
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 400)).mockResolvedValueOnce(jsonResponse({}, 500))

    await flushQueue()

    expect(await idbCount('queue')).toBe(1)
  })

  it('refreshes the token once on 401 and retries the entry', async () => {
    const fetchMock = vi.mocked(fetch)
    await enqueueMutation('/api/v1/books/files/7/progress', { method: 'POST', body: '{"percentage":1}' })
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 401)).mockResolvedValueOnce(jsonResponse({}, 200))

    await flushQueue()

    expect(refreshAccessToken).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(await idbCount('queue')).toBe(0)
  })

  it('leaves the queue untouched while offline', async () => {
    const fetchMock = vi.mocked(fetch)
    await enqueueMutation('/api/v1/books/1/bookmarks', { method: 'POST', body: '{}' })
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })

    await flushQueue()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(await idbCount('queue')).toBe(1)
  })

  it('attaches the current access token when replaying', async () => {
    const fetchMock = vi.mocked(fetch)
    await enqueueMutation('/api/v1/books/1/bookmarks', { method: 'POST', body: '{}' })
    fetchMock.mockResolvedValue(jsonResponse({}))

    await flushQueue()

    const [, init] = fetchMock.mock.calls[0]!
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer test-token' })
    expect(getAccessToken).toHaveBeenCalled()
  })
})
