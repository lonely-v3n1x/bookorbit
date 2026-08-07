const DB_NAME = 'bookorbit-offline'
const DB_VERSION = 1

export type OfflineStore = 'books' | 'queue' | 'kv'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'key' })
      if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Failed to open offline database'))
  })
  return dbPromise
}

function run<T>(store: OfflineStore, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = fn(db.transaction(store, mode).objectStore(store))
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error(`IndexedDB ${store} operation failed`))
      }),
  )
}

export async function idbGet<T>(store: OfflineStore, key: IDBValidKey): Promise<T | undefined> {
  try {
    return await run<T | undefined>(store, 'readonly', (s) => s.get(key))
  } catch {
    return undefined
  }
}

export async function idbPut(store: OfflineStore, value: unknown, key?: IDBValidKey): Promise<void> {
  try {
    await run(store, 'readwrite', (s) => (key === undefined ? s.put(value) : s.put(value, key)))
  } catch {
    // Offline storage is best-effort: never let a storage failure break the app.
  }
}

export async function idbDelete(store: OfflineStore, key: IDBValidKey): Promise<void> {
  try {
    await run(store, 'readwrite', (s) => s.delete(key))
  } catch {
    // best-effort
  }
}

export async function idbAll<T>(store: OfflineStore): Promise<T[]> {
  try {
    const db = await openDb()
    return await new Promise<T[]>((resolve, reject) => {
      const request = db.transaction(store, 'readonly').objectStore(store).getAll()
      request.onsuccess = () => resolve(request.result as T[])
      request.onerror = () => reject(request.error ?? new Error(`IndexedDB ${store} getAll failed`))
    })
  } catch {
    return []
  }
}

export async function idbCount(store: OfflineStore): Promise<number> {
  try {
    return await run(store, 'readonly', (s) => s.count())
  } catch {
    return 0
  }
}

/** Wipes every offline store (downloads, outbox, id map). Used by tests and a future reset action. */
export async function clearOfflineStores(): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['books', 'queue', 'kv'], 'readwrite')
      for (const store of ['books', 'queue', 'kv'] as OfflineStore[]) tx.objectStore(store).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('Failed to clear offline stores'))
    })
  } catch {
    // best-effort
  }
}
