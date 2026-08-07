<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { Download, HardDriveDownload, RefreshCw, Trash2, Wifi, WifiOff } from '@lucide/vue'
import { formatDate } from '@/i18n/formatters'
import { formatBytes } from '@/lib/formatting'
import { bookCoverStyle } from '@/features/book/lib/book-cover'
import {
  isOfflineSupported,
  isOnline,
  listOfflineBooks,
  offlineBooted,
  pendingSyncCount,
  refreshOfflineState,
  removeOfflineBook,
  type OfflineBookMeta,
} from '@/lib/offline'
import { flushQueue } from '@/lib/offline'

const { t } = useI18n()
const router = useRouter()

const books = ref<OfflineBookMeta[]>([])
const loading = ref(true)
const syncing = ref(false)

async function reload() {
  books.value = await listOfflineBooks()
  await refreshOfflineState()
  loading.value = false
}

function openBook(book: OfflineBookMeta) {
  router.push({
    name: 'reader',
    params: { bookId: book.bookId, fileId: book.fileId },
    query: { format: book.format },
  })
}

async function removeBook(book: OfflineBookMeta) {
  await removeOfflineBook(book.bookId, book.fileId)
  books.value = books.value.filter((b) => b.key !== book.key)
  toast.success(t('offline.file.removed'))
}

async function syncNow() {
  if (syncing.value) return
  syncing.value = true
  try {
    await flushQueue()
    await reload()
  } finally {
    syncing.value = false
  }
}

const totalBytes = computed(() => books.value.reduce((sum, b) => sum + (b.sizeBytes ?? 0), 0))
const supported = isOfflineSupported()

onMounted(() => {
  void reload()
})
</script>

<template>
  <div class="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
    <header class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight text-foreground">{{ t('offline.title') }}</h1>
        <p class="mt-1 text-sm text-muted-foreground">
          {{ t('offline.subtitle') }}
          <span v-if="books.length > 0" class="mx-1 opacity-40">·</span>
          <span v-if="books.length > 0">{{ t('offline.storedSummary', { count: books.length, size: formatBytes(totalBytes) }) }}</span>
        </p>
      </div>
    </header>

    <div v-if="!supported" class="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
      {{ t('offline.unsupported') }}
    </div>

    <div v-else-if="!isOnline" class="mb-4 flex items-center gap-3 rounded-lg border border-border bg-card p-4">
      <WifiOff class="size-4 shrink-0 text-muted-foreground" />
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium text-foreground">{{ t('offline.offlineMode') }}</p>
        <p v-if="offlineBooted" class="text-xs text-muted-foreground">{{ t('offline.offlineBootHint') }}</p>
      </div>
      <Wifi class="size-4 shrink-0 text-muted-foreground" />
    </div>

    <div v-else-if="pendingSyncCount > 0" class="mb-4 flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
      <RefreshCw class="size-4 shrink-0 text-primary" />
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium text-foreground">{{ t('offline.pendingSync', { count: pendingSyncCount }) }}</p>
        <p class="text-xs text-muted-foreground">{{ t('offline.pendingSyncHint') }}</p>
      </div>
      <button
        class="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        :disabled="syncing"
        @click="syncNow"
      >
        <RefreshCw class="size-3.5" :class="syncing ? 'animate-spin' : ''" />
        {{ t('offline.syncNow') }}
      </button>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-24 text-sm text-muted-foreground">
      {{ t('common.loading') }}
    </div>

    <div
      v-else-if="books.length === 0"
      class="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-24 text-center"
    >
      <div class="flex size-12 items-center justify-center rounded-2xl border border-primary/15 bg-primary/10 text-primary">
        <HardDriveDownload class="size-5" />
      </div>
      <p class="mt-4 text-sm font-semibold text-foreground">{{ t('offline.emptyTitle') }}</p>
      <p class="mt-1 max-w-xs text-sm text-muted-foreground">{{ t('offline.emptyDescription') }}</p>
    </div>

    <div v-else class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      <div v-for="book in books" :key="book.key" class="group flex flex-col">
        <button
          class="relative aspect-[2/3] overflow-hidden rounded-lg border border-border/70 bg-muted transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:shadow-lg"
          :style="book.coverUrl ? undefined : bookCoverStyle(book.title)"
          @click="openBook(book)"
        >
          <img v-if="book.coverUrl" :src="book.coverUrl" :alt="book.title" class="h-full w-full object-cover" loading="lazy" />
          <div v-else class="flex h-full w-full flex-col items-center justify-center gap-1 p-3 text-center">
            <span class="line-clamp-4 font-serif text-sm font-semibold leading-snug">{{ book.title }}</span>
          </div>
          <div
            class="absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white backdrop-blur"
          >
            <Download class="size-3" />
            {{ book.format }}
          </div>
        </button>
        <div class="mt-2 flex min-w-0 items-start justify-between gap-2">
          <button class="min-w-0 text-left" :title="t('offline.open')" @click="openBook(book)">
            <p class="truncate text-sm font-medium text-foreground transition-colors hover:text-primary">{{ book.title }}</p>
            <p class="mt-0.5 text-xs text-muted-foreground">
              {{ formatBytes(book.sizeBytes) }}
              <span class="mx-1 opacity-40">·</span>
              {{ formatDate(new Date(book.downloadedAt), { year: 'numeric', month: 'short', day: 'numeric' }) }}
            </p>
          </button>
          <button
            class="shrink-0 rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
            :title="t('offline.file.remove')"
            @click="removeBook(book)"
          >
            <Trash2 class="size-4" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
