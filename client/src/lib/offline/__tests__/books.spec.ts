import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import { clearOfflineStores } from '../db'
import { downloadOfflineBook, isBookOffline, listOfflineBooks, removeOfflineBook } from '../books'

vi.mock('@/lib/api', () => ({
  api: vi.fn<typeof api>(),
}))

const epubInfo = {
  containerPath: 'OPS/package.opf',
  rootPath: 'OPS/',
  manifest: [
    { id: 't1', href: 'OPS/text/chapter1.xhtml', mediaType: 'application/xhtml+xml', size: 10 },
    { id: 'img', href: 'OPS/images/cover.jpg', mediaType: 'image/jpeg', size: 5 },
  ],
  spine: [],
  optionalFiles: [],
  toc: null,
  metadata: { title: 'Test Book' },
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

describe('offline books', () => {
  const cachePuts: string[] = []
  let cache: {
    put: ReturnType<typeof vi.fn>
    keys: ReturnType<typeof vi.fn>
    delete: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    await clearOfflineStores()
    cachePuts.length = 0
    cache = {
      put: vi.fn<(request: RequestInfo | URL) => Promise<void>>(async (request: RequestInfo | URL) => {
        cachePuts.push(String(request))
      }),
      keys: vi.fn<() => Promise<Request[]>>(async () => []),
      delete: vi.fn<() => Promise<boolean>>(async () => true),
    }
    vi.stubGlobal('caches', { open: vi.fn<() => Promise<typeof cache>>(async () => cache) })
    vi.mocked(api).mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('downloads an epub by prefetching the manifest and every resource', async () => {
    const apiMock = vi.mocked(api)
    apiMock.mockImplementation(async (input) => {
      const url = String(input)
      return url.includes('/info?') ? jsonResponse(epubInfo) : jsonResponse({})
    })
    const progress: number[] = []

    await downloadOfflineBook({ bookId: 1, fileId: 2, format: 'epub', title: 'Test Book', coverUrl: null, sizeBytes: null }, (fraction) =>
      progress.push(fraction),
    )

    // info + container.xml + package.opf + 2 manifest items
    expect(apiMock).toHaveBeenCalledTimes(5)
    expect(cachePuts.some((url) => url.includes('/file/META-INF/container.xml?fileId=2'))).toBe(true)
    expect(cachePuts.some((url) => url.includes('/file/OPS/package.opf?fileId=2'))).toBe(true)
    expect(cachePuts.some((url) => url.includes('/file/OPS/text/chapter1.xhtml?fileId=2'))).toBe(true)
    expect(cachePuts.some((url) => url.includes('/file/OPS/images/cover.jpg?fileId=2'))).toBe(true)
    expect(progress[progress.length - 1]).toBe(1)
    expect(await isBookOffline(1, 2)).toBe(true)
  })

  it('caches the whole serve file for pdf and persists metadata', async () => {
    const apiMock = vi.mocked(api)
    apiMock.mockResolvedValue(jsonResponse({}))

    await downloadOfflineBook({ bookId: 1, fileId: 9, format: 'pdf', title: 'Doc', coverUrl: null, sizeBytes: 1024 })

    expect(apiMock).toHaveBeenCalledWith('/api/v1/books/files/9/serve')
    expect(cachePuts).toContain('/api/v1/books/files/9/serve')
    expect(await isBookOffline(1, 9)).toBe(true)

    const books = await listOfflineBooks()
    expect(books).toHaveLength(1)
    expect(books[0]).toMatchObject({ bookId: 1, fileId: 9, format: 'pdf', title: 'Doc', sizeBytes: 1024 })
  })

  it('removes the book metadata and only its cached entries', async () => {
    const apiMock = vi.mocked(api)
    apiMock.mockResolvedValue(jsonResponse({}))
    await downloadOfflineBook({ bookId: 1, fileId: 9, format: 'pdf', title: 'Doc', coverUrl: null, sizeBytes: 10 })
    cache.keys.mockResolvedValue([
      new Request('http://localhost/api/v1/books/files/9/serve'),
      new Request('http://localhost/api/v1/books/files/999/serve'),
    ])

    await removeOfflineBook(1, 9)

    expect(cache.delete).toHaveBeenCalledTimes(1)
    expect((cache.delete.mock.calls[0]![0] as Request).url).toContain('/books/files/9/serve')
    expect(await isBookOffline(1, 9)).toBe(false)
  })

  it('reports an error when a prefetch request fails', async () => {
    const apiMock = vi.mocked(api)
    apiMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/info?')) return jsonResponse(epubInfo)
      return new Response(null, { status: 404 })
    })

    await expect(downloadOfflineBook({ bookId: 1, fileId: 2, format: 'epub', title: 'T', coverUrl: null, sizeBytes: null })).rejects.toThrow(
      'Failed to fetch',
    )

    expect(await isBookOffline(1, 2)).toBe(false)
  })
})
