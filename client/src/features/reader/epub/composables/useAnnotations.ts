import { ref } from 'vue'
import type { AnnotationItem } from '@bookorbit/types'
import { api } from '@/lib/api'
import { isQueuedResponse, makeTempId, type ReconciledMutation } from '@/lib/offline/queue'

export type Annotation = AnnotationItem

export interface AnnotationPatch {
  note?: string | null
  color?: string
  style?: string
}

type ReconcileHandler = (mutations: ReconciledMutation[]) => void
let activeReconcileHandler: ReconcileHandler | null = null

if (typeof window !== 'undefined') {
  window.addEventListener('bookorbit:offline-reconciled', ((event: Event) => {
    const detail = (event as CustomEvent<{ mutations: ReconciledMutation[] }>).detail
    activeReconcileHandler?.(detail?.mutations ?? [])
  }) as EventListener)
}

export function useAnnotations() {
  const annotations = ref<Annotation[]>([])
  const loadError = ref<string | null>(null)

  // Replace locally-created (pending) annotations with the real server rows after sync.
  activeReconcileHandler = (mutations) => {
    for (const mutation of mutations) {
      if (!mutation.url.includes('/annotations')) continue
      const real = mutation.data as Annotation | null
      if (!real || typeof real.id !== 'number') continue
      if (!annotations.value.some((a) => a.id === mutation.tempId)) continue
      annotations.value = annotations.value.map((a) => (a.id === mutation.tempId ? real : a))
    }
  }

  async function load(bookId: number) {
    loadError.value = null
    const res = await api(`/api/v1/books/${bookId}/annotations`)
    if (!res.ok) {
      loadError.value = 'Failed to load'
      return
    }
    annotations.value = await res.json()
  }

  async function create(
    bookId: number,
    data: { cfi: string; bookFileId?: number; text: string; color: string; style: string; note?: string | null; chapterTitle?: string | null },
  ): Promise<Annotation | null> {
    const res = await api(`/api/v1/books/${bookId}/annotations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (isQueuedResponse(res)) {
      // Offline: keep a local pending annotation; the outbox creates it on the server later.
      const pending: Annotation = {
        id: makeTempId(),
        bookId,
        cfi: data.cfi,
        jumpFileId: null,
        pageno: null,
        text: data.text,
        color: data.color,
        style: data.style,
        note: data.note ?? null,
        chapterTitle: data.chapterTitle ?? null,
        origin: 'web',
        positionStatus: 'pending',
        chapterIndex: null,
        createdAt: new Date().toISOString(),
      }
      annotations.value = [...annotations.value, pending]
      return pending
    }
    if (!res.ok) return null
    const created: Annotation = await res.json()
    annotations.value = [...annotations.value, created]
    return created
  }

  async function update(bookId: number, id: number, data: AnnotationPatch): Promise<Annotation | null> {
    const res = await api(`/api/v1/books/${bookId}/annotations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (isQueuedResponse(res)) {
      // Offline: apply the patch locally; the outbox replays it against the server later.
      annotations.value = annotations.value.map((a) => (a.id === id ? { ...a, ...data } : a))
      return annotations.value.find((a) => a.id === id) ?? null
    }
    if (!res.ok) return null

    const updated: Annotation = await res.json()
    annotations.value = annotations.value.map((a) => (a.id === id ? updated : a))
    return updated
  }

  function updateNote(bookId: number, id: number, note: string | null): Promise<Annotation | null> {
    return update(bookId, id, { note })
  }

  async function remove(bookId: number, id: number) {
    const res = await api(`/api/v1/books/${bookId}/annotations/${id}`, {
      method: 'DELETE',
    })
    if (res.ok) {
      annotations.value = annotations.value.filter((a) => a.id !== id)
    }
  }

  return { annotations, loadError, load, create, update, updateNote, remove }
}
