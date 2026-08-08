<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDown, ArrowUp, Copy, ExternalLink, Link2, Search, Trash2 } from '@lucide/vue'

import { useAuth } from '@/features/auth/composables/useAuth'
import { copyToClipboard } from '@/lib/clipboard'
import { toast } from 'vue-sonner'
import {
  fetchMyPublicShelf,
  publicShelfCoverUrl,
  searchPublicShelfBooks,
  updateMyPublicShelf,
  type PublicShelfBook,
  type PublicShelfSearchResult,
} from './lib/api'

const { t } = useI18n()
const { user } = useAuth()

const books = ref<PublicShelfBook[]>([])
const loading = ref(false)
const loaded = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)

const searchQuery = ref('')
const searchResults = ref<PublicShelfSearchResult[]>([])
const searching = ref(false)
const searchOpen = ref(false)

const userId = computed(() => user.value?.id ?? null)
const publicUrl = computed(() => (userId.value ? `${window.location.origin}/public/${userId.value}` : null))

const onShelfIds = computed(() => new Set(books.value.map((b) => b.bookId)))

async function load() {
  loading.value = true
  error.value = null
  try {
    books.value = await fetchMyPublicShelf()
    loaded.value = true
  } catch {
    error.value = t('settings.publicPage.errors.load')
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  error.value = null
  try {
    await updateMyPublicShelf(books.value.map((b) => b.bookId))
    toast.success(t('settings.publicPage.saved'))
  } catch {
    error.value = t('settings.publicPage.errors.save')
  } finally {
    saving.value = false
  }
}

async function handleSearch() {
  const q = searchQuery.value.trim()
  if (q.length < 2) {
    searchResults.value = []
    return
  }
  searching.value = true
  try {
    searchResults.value = await searchPublicShelfBooks(q)
    searchOpen.value = true
  } finally {
    searching.value = false
  }
}

function addBook(result: PublicShelfSearchResult) {
  if (onShelfIds.value.has(result.id)) return
  books.value.push({ bookId: result.id, title: result.title ?? '', hasCover: false, rating: null, progressPercent: null })
  searchResults.value = []
  searchQuery.value = ''
  searchOpen.value = false
  void save()
  // Reload so cover/progress/rating reflect the server's authoritative values.
  void load()
}

function removeBook(bookId: number) {
  books.value = books.value.filter((b) => b.bookId !== bookId)
  void save()
}

function moveBook(index: number, direction: -1 | 1) {
  const target = index + direction
  if (target < 0 || target >= books.value.length) return
  const list = [...books.value]
  ;[list[index], list[target]] = [list[target], list[index]]
  books.value = list
  void save()
}

async function copyLink() {
  if (!publicUrl.value) return
  const ok = await copyToClipboard(publicUrl.value)
  if (ok) {
    toast.success(t('settings.publicPage.linkCopied'))
  } else {
    toast.error(t('settings.publicPage.errors.copy'))
  }
}

onMounted(load)
</script>

<template>
  <section aria-labelledby="public-page-heading" class="space-y-6">
    <div>
      <h2 id="public-page-heading" class="settings-group-label mb-0">{{ t('settings.publicPage.title') }}</h2>
      <p class="settings-hint">{{ t('settings.publicPage.subtitle') }}</p>
    </div>

    <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
    <p v-if="loading" role="status" class="text-sm text-muted-foreground">{{ t('common.loading') }}</p>

    <template v-if="loaded">
      <!-- Public link -->
      <div v-if="publicUrl" class="rounded-lg border border-border bg-card p-4 shadow-xs md:p-5">
        <p class="settings-label">{{ t('settings.publicPage.linkTitle') }}</p>
        <div class="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <code class="min-w-0 flex-1 truncate rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-foreground">{{ publicUrl }}</code>
          <div class="flex shrink-0 gap-2">
            <button type="button" class="settings-btn-outline justify-center gap-2" @click="copyLink">
              <Copy :size="14" aria-hidden="true" />
              {{ t('settings.publicPage.copyLink') }}
            </button>
            <a :href="publicUrl" target="_blank" rel="noopener noreferrer" class="settings-btn-outline justify-center gap-2">
              <ExternalLink :size="14" aria-hidden="true" />
              {{ t('settings.publicPage.open') }}
            </a>
          </div>
        </div>
        <p class="settings-hint mt-3">{{ t('settings.publicPage.linkHint') }}</p>
      </div>

      <!-- Add book search -->
      <div class="relative rounded-lg border border-border bg-card p-4 shadow-xs md:p-5">
        <p class="settings-label">{{ t('settings.publicPage.addTitle') }}</p>
        <p class="settings-hint">{{ t('settings.publicPage.addHint') }}</p>
        <div class="relative mt-3">
          <Search :size="15" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            v-model="searchQuery"
            type="search"
            :placeholder="t('settings.publicPage.searchPlaceholder')"
            class="w-full rounded-md border border-input bg-background py-2 pl-9 pr-3 text-sm shadow-xs outline-none transition-colors focus:border-primary"
            @input="handleSearch"
          />
        </div>
        <ul
          v-if="searchOpen && searchResults.length > 0"
          class="mt-2 max-h-64 divide-y divide-border overflow-y-auto rounded-md border border-border bg-background"
        >
          <li v-for="result in searchResults" :key="result.id">
            <button
              type="button"
              class="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-muted disabled:opacity-50"
              :disabled="onShelfIds.has(result.id)"
              @click="addBook(result)"
            >
              <span class="min-w-0 truncate">
                {{ result.title }}
                <span v-if="result.seriesName" class="text-xs text-muted-foreground"> · {{ result.seriesName }}</span>
              </span>
              <span class="shrink-0 text-xs text-muted-foreground">
                {{ onShelfIds.has(result.id) ? t('settings.publicPage.alreadyAdded') : t('settings.publicPage.add') }}
              </span>
            </button>
          </li>
        </ul>
        <p v-else-if="searching" class="mt-2 text-xs text-muted-foreground">{{ t('common.loading') }}</p>
        <p v-else-if="searchOpen && searchQuery.trim().length >= 2" class="mt-2 text-xs text-muted-foreground">
          {{ t('settings.publicPage.noResults') }}
        </p>
      </div>

      <!-- Current shelf -->
      <div class="rounded-lg border border-border bg-card p-4 shadow-xs md:p-5">
        <div class="flex items-center justify-between gap-3">
          <p class="settings-label mb-0">
            {{ t('settings.publicPage.shelfTitle') }}
            <span class="text-muted-foreground">({{ books.length }})</span>
          </p>
          <button type="button" class="settings-btn-primary justify-center" :disabled="saving" @click="save">
            {{ saving ? t('common.loading') : t('common.save') }}
          </button>
        </div>

        <p v-if="books.length === 0" class="mt-4 text-sm text-muted-foreground">
          {{ t('settings.publicPage.empty') }}
        </p>

        <ul v-else class="mt-4 divide-y divide-border">
          <li v-for="(book, index) in books" :key="book.bookId" class="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
            <div class="flex shrink-0 flex-col gap-1">
              <button
                type="button"
                class="rounded border border-border p-1 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30"
                :disabled="index === 0"
                :aria-label="t('settings.publicPage.moveUp')"
                @click="moveBook(index, -1)"
              >
                <ArrowUp :size="13" aria-hidden="true" />
              </button>
              <button
                type="button"
                class="rounded border border-border p-1 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30"
                :disabled="index === books.length - 1"
                :aria-label="t('settings.publicPage.moveDown')"
                @click="moveBook(index, 1)"
              >
                <ArrowDown :size="13" aria-hidden="true" />
              </button>
            </div>

            <div class="h-16 w-11 shrink-0 overflow-hidden rounded-sm border border-border bg-muted/40">
              <img
                v-if="book.hasCover && userId"
                :src="publicShelfCoverUrl(userId, book.bookId)"
                :alt="book.title"
                class="h-full w-full object-cover"
                loading="lazy"
              />
            </div>

            <div class="min-w-0 flex-1">
              <p class="settings-label truncate">{{ book.title }}</p>
              <p class="mt-0.5 text-xs text-muted-foreground">
                <template v-if="book.progressPercent != null && book.progressPercent > 0">{{ book.progressPercent }}%</template>
                <template v-if="book.rating">{{ t('settings.publicPage.rating', { rating: book.rating }) }}</template>
              </p>
            </div>

            <button
              type="button"
              class="shrink-0 rounded-md p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              :aria-label="t('settings.publicPage.remove')"
              @click="removeBook(book.bookId)"
            >
              <Trash2 :size="15" aria-hidden="true" />
            </button>
          </li>
        </ul>
      </div>
    </template>

    <a v-if="publicUrl" :href="publicUrl" class="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
      <Link2 :size="13" aria-hidden="true" />
      {{ t('settings.publicPage.viewPublic') }}
    </a>
  </section>
</template>
