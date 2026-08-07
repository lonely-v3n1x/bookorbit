import { countOfflineBooks } from './books'
import { countPendingSync, flushQueue } from './queue'
import { downloadedCount, isOnline, pendingSyncCount } from './state'

export {
  downloadOfflineBook,
  getOfflineBook,
  isBookOffline,
  listOfflineBooks,
  removeOfflineBook,
  countOfflineBooks,
  OFFLINE_FILES_CACHE,
  type OfflineBookMeta,
} from './books'
export { flushQueue, isQueuedResponse, makeTempId, countPendingSync, type ReconciledMutation } from './queue'
export { downloadedCount, pendingSyncCount, offlineBooted, isOnline, isOfflineSupported } from './state'

export async function refreshOfflineState(): Promise<void> {
  downloadedCount.value = await countOfflineBooks()
  pendingSyncCount.value = await countPendingSync()
}

/** Wire connectivity listeners and flush any queued mutations. Call once at app boot. */
export function initOffline(): void {
  if (typeof window === 'undefined') return

  window.addEventListener('online', () => {
    isOnline.value = true
    void flushQueue()
    void reconnect()
  })
  window.addEventListener('offline', () => {
    isOnline.value = false
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine) void flushQueue()
  })

  if (navigator.onLine) void flushQueue()
}

/** Restores the session after a reconnect so the app leaves offline mode without a reload. */
async function reconnect(): Promise<void> {
  const { useAuth } = await import('@/features/auth/composables/useAuth')
  await useAuth().init()
}
