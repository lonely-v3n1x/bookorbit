import { computed, ref } from 'vue'
import { api } from '@/lib/api'
import { isQueuedResponse, makeTempId, type ReconciledMutation } from '@/lib/offline/queue'

export interface Bookmark {
  id: number
  bookId: number
  cfi: string
  title: string
  createdAt: string
}

type ReconcileHandler = (mutations: ReconciledMutation[]) => void
let activeReconcileHandler: ReconcileHandler | null = null

if (typeof window !== 'undefined') {
  window.addEventListener('bookorbit:offline-reconciled', ((event: Event) => {
    const detail = (event as CustomEvent<{ mutations: ReconciledMutation[] }>).detail
    activeReconcileHandler?.(detail?.mutations ?? [])
  }) as EventListener)
}

export function useBookmarks() {
  const bookmarks = ref<Bookmark[]>([])
  const currentCfi = ref<string | null>(null)
  const loadError = ref<string | null>(null)

  // Replace locally-created (pending) bookmarks with the real server rows after sync.
  activeReconcileHandler = (mutations) => {
    for (const mutation of mutations) {
      if (!mutation.url.includes('/bookmarks')) continue
      const real = mutation.data as Bookmark | null
      if (!real || typeof real.id !== 'number') continue
      if (!bookmarks.value.some((b) => b.id === mutation.tempId)) continue
      bookmarks.value = bookmarks.value.map((b) => (b.id === mutation.tempId ? real : b))
    }
  }

  const isCurrentCfiBookmarked = computed(() => {
    if (!currentCfi.value) return false
    return bookmarks.value.some((b) => b.cfi === currentCfi.value)
  })

  function setCfi(cfi: string | null) {
    currentCfi.value = cfi
  }

  async function load(bookId: number) {
    loadError.value = null
    const res = await api(`/api/v1/books/${bookId}/bookmarks`)
    if (!res.ok) {
      loadError.value = 'Failed to load'
      return
    }
    bookmarks.value = await res.json()
  }

  async function toggle(bookId: number, cfi: string, title: string) {
    const existing = bookmarks.value.find((b) => b.cfi === cfi)
    if (existing) {
      await remove(bookId, existing.id)
    } else {
      const res = await api(`/api/v1/books/${bookId}/bookmarks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cfi, title }),
      })
      if (isQueuedResponse(res)) {
        // Offline: keep a local pending bookmark; the outbox creates it on the server later.
        bookmarks.value = [...bookmarks.value, { id: makeTempId(), bookId, cfi, title, createdAt: new Date().toISOString() }]
        return
      }
      if (res.ok) {
        const created: Bookmark = await res.json()
        bookmarks.value = [...bookmarks.value, created]
      }
    }
  }

  async function remove(bookId: number, bookmarkId: number) {
    const res = await api(`/api/v1/books/${bookId}/bookmarks/${bookmarkId}`, {
      method: 'DELETE',
    })
    if (res.ok) {
      bookmarks.value = bookmarks.value.filter((b) => b.id !== bookmarkId)
    }
  }

  return {
    bookmarks,
    isCurrentCfiBookmarked,
    currentCfi,
    loadError,
    setCfi,
    load,
    toggle,
    remove,
  }
}
