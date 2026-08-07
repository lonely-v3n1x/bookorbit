import { api } from '@/lib/api'
import type { EpubBookInfo } from '@bookorbit/types'
import { idbAll, idbCount, idbDelete, idbGet, idbPut } from './db'
import { downloadedCount } from './state'

/** Shared with the workbox runtime cache in vite.config.ts so the service worker can serve these offline. */
export const OFFLINE_FILES_CACHE = 'bookorbit-offline-v1'
/** Existing workbox cover cache (CacheFirst) - prefetch covers into it so the downloaded shelf renders offline. */
export const COVERS_CACHE = 'book-covers'

export interface OfflineBookMeta {
  key: string
  bookId: number
  fileId: number
  format: string
  title: string
  author?: string | null
  coverUrl: string | null
  sizeBytes: number | null
  downloadedAt: number
}

const key = (bookId: number, fileId: number): string => `${bookId}:${fileId}`

export async function isBookOffline(bookId: number, fileId: number): Promise<boolean> {
  return (await idbGet<OfflineBookMeta>('books', key(bookId, fileId))) != null
}

export async function getOfflineBook(bookId: number, fileId: number): Promise<OfflineBookMeta | undefined> {
  return idbGet<OfflineBookMeta>('books', key(bookId, fileId))
}

export async function listOfflineBooks(): Promise<OfflineBookMeta[]> {
  const books = await idbAll<OfflineBookMeta>('books')
  return books.sort((a, b) => b.downloadedAt - a.downloadedAt)
}

export async function countOfflineBooks(): Promise<number> {
  return idbCount('books')
}

async function putInCache(cacheName: string, url: string, res: Response): Promise<void> {
  const cache = await caches.open(cacheName)
  await cache.put(url, res.clone())
}

/** Mirrors the foliate streaming loader's URL format exactly. */
function epubFileUrl(bookId: number, fileId: number, filePath: string): string {
  const encodedPath = filePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return `/api/v1/epub/${bookId}/file/${encodedPath}?fileId=${fileId}`
}

function isBookCacheEntry(url: string, bookId: number, fileId: number): boolean {
  return url.includes(`/api/v1/epub/${bookId}/file/`) || url.includes(`/api/v1/books/files/${fileId}/serve`)
}

/**
 * Downloads a book for offline reading:
 * - EPUB: prefetches the manifest info plus every resource the streaming loader reads.
 * - Other formats (PDF, CBZ, MOBI, FB2, ...): caches the whole `/serve` file the reader opens.
 * Falls back to the whole-file cache when the EPUB manifest cannot be resolved.
 */
export async function downloadOfflineBook(
  meta: Omit<OfflineBookMeta, 'key' | 'downloadedAt'>,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  const { bookId, fileId, format } = meta

  if (format === 'epub') {
    const infoUrl = `/api/v1/epub/${bookId}/info?fileId=${fileId}`
    const infoRes = await api(infoUrl)
    if (!infoRes.ok) throw new Error(`Failed to fetch EPUB info: ${infoRes.status}`)
    await putInCache(OFFLINE_FILES_CACHE, infoUrl, infoRes)

    const info = (await infoRes.json().catch(() => null)) as EpubBookInfo | null
    if (info?.manifest && Array.isArray(info.manifest) && info.manifest.length > 0) {
      const paths = new Set<string>()
      paths.add('META-INF/container.xml')
      if (info.containerPath) paths.add(info.containerPath)
      for (const item of info.manifest) {
        if (item?.href) paths.add(item.href)
      }
      for (const optional of info.optionalFiles ?? []) paths.add(optional)

      const all = [...paths]
      let done = 0
      for (const filePath of all) {
        const url = epubFileUrl(bookId, fileId, filePath)
        const res = await api(url)
        if (!res.ok) throw new Error(`Failed to fetch ${filePath}: ${res.status}`)
        await putInCache(OFFLINE_FILES_CACHE, url, res)
        done += 1
        onProgress?.(done / all.length)
      }
    } else {
      // No manifest available - cache the whole file so the reader can still open it offline.
      await downloadServeFile(bookId, fileId)
    }
  } else {
    await downloadServeFile(bookId, fileId)
  }

  if (meta.coverUrl) {
    try {
      const coverRes = await api(meta.coverUrl)
      if (coverRes.ok) await putInCache(COVERS_CACHE, meta.coverUrl, coverRes)
    } catch {
      // Cover is optional - the shelf falls back to a placeholder.
    }
  }

  await idbPut('books', {
    ...meta,
    key: key(bookId, fileId),
    downloadedAt: Date.now(),
    sizeBytes: meta.sizeBytes ?? null,
  })
  downloadedCount.value = await countOfflineBooks()
}

async function downloadServeFile(bookId: number, fileId: number): Promise<void> {
  const url = `/api/v1/books/files/${fileId}/serve`
  const res = await api(url)
  if (!res.ok) throw new Error(`Failed to fetch book file: ${res.status}`)
  await putInCache(OFFLINE_FILES_CACHE, url, res)
}

export async function removeOfflineBook(bookId: number, fileId: number): Promise<void> {
  await idbDelete('books', key(bookId, fileId))
  try {
    const cache = await caches.open(OFFLINE_FILES_CACHE)
    const requests = await cache.keys()
    const doomed = requests.filter((request) => isBookCacheEntry(request.url, bookId, fileId))
    await Promise.all(doomed.map((request) => cache.delete(request)))
  } catch {
    // best-effort cleanup
  }
  downloadedCount.value = await countOfflineBooks()
}
