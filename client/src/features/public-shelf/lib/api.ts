import { api } from '@/lib/api'

export interface PublicShelfBook {
  bookId: number
  title: string
  hasCover: boolean
  rating: number | null
  progressPercent: number | null
}

export interface PublicShelfResponse {
  userId: number
  username: string
  name: string
  books: PublicShelfBook[]
}

export interface PublicShelfSearchResult {
  id: number
  title: string | null
  seriesName?: string | null
  libraryName?: string | null
}

/** Current user's curated shelf (authenticated). */
export async function fetchMyPublicShelf(): Promise<PublicShelfBook[]> {
  const res = await api('/api/v1/public-shelf/me')
  if (!res.ok) throw new Error('Failed to load public shelf')
  return (await res.json()) as PublicShelfBook[]
}

/** Replace the current user's shelf with an ordered list of book ids (authenticated). */
export async function updateMyPublicShelf(bookIds: number[]): Promise<void> {
  const res = await api('/api/v1/public-shelf/me', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookIds }),
  })
  if (!res.ok) throw new Error('Failed to update public shelf')
}

/** Public page payload for any user (no auth required). */
export async function fetchPublicShelf(userId: number): Promise<PublicShelfResponse> {
  const res = await fetch(`/api/v1/public-shelf/${userId}`)
  if (!res.ok) throw new Error('Failed to load public page')
  return (await res.json()) as PublicShelfResponse
}

/** Cover image URL for a book on a user's public shelf (public endpoint). */
export function publicShelfCoverUrl(userId: number, bookId: number): string {
  return `/api/v1/public-shelf/${userId}/cover/${bookId}`
}

/** Lightweight book search used by the curation picker (authenticated). */
export async function searchPublicShelfBooks(query: string): Promise<PublicShelfSearchResult[]> {
  const res = await api(`/api/v1/books/search?q=${encodeURIComponent(query)}&limit=8`)
  if (!res.ok) return []
  return (await res.json()) as PublicShelfSearchResult[]
}
