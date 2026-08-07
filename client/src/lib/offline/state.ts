import { ref } from 'vue'

/** Number of books currently stored on this device for offline reading. */
export const downloadedCount = ref(0)

/** Number of queued mutations waiting to sync back to the server. */
export const pendingSyncCount = ref(0)

/** True when the app was booted without a reachable server but with a stored session. */
export const offlineBooted = ref(false)

export const isOnline = ref(typeof navigator === 'undefined' ? true : navigator.onLine)

export function isOfflineSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'caches' in window && 'indexedDB' in window
}
