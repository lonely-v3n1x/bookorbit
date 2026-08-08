<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { BookOpen, Star } from '@lucide/vue'

import { fetchPublicShelf, publicShelfCoverUrl, type PublicShelfResponse } from './lib/api'

const props = defineProps<{ userId: number }>()

const { t } = useI18n()
const shelf = ref<PublicShelfResponse | null>(null)
const loading = ref(true)
const error = ref(false)

const hasAnyProgress = computed(() => (shelf.value?.books ?? []).some((b) => b.progressPercent != null && b.progressPercent > 0))
const hasAnyRating = computed(() => (shelf.value?.books ?? []).some((b) => b.rating != null))

onMounted(async () => {
  try {
    shelf.value = await fetchPublicShelf(props.userId)
  } catch {
    error.value = true
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <main class="min-h-dvh bg-background text-foreground">
    <!-- Header -->
    <header class="border-b border-border/60 bg-gradient-to-b from-primary/5 to-transparent">
      <div class="mx-auto flex max-w-5xl flex-col items-center gap-1 px-4 py-10 text-center md:py-14">
        <div class="flex items-center gap-2 text-primary">
          <BookOpen :size="26" aria-hidden="true" />
        </div>
        <h1 class="mt-3 text-2xl font-bold tracking-tight md:text-3xl">
          {{ shelf ? shelf.name || shelf.username : t('publicShelf.loading') }}
        </h1>
        <p class="mt-1 text-sm text-muted-foreground">
          {{ t('publicShelf.subtitle', { count: shelf?.books.length ?? 0 }) }}
        </p>
      </div>
    </header>

    <!-- Body -->
    <div class="mx-auto max-w-5xl px-4 py-8 md:py-10">
      <p v-if="loading" role="status" class="text-center text-sm text-muted-foreground">{{ t('publicShelf.loading') }}</p>

      <div v-else-if="error" class="mx-auto max-w-md rounded-lg border border-border bg-card p-6 text-center shadow-xs">
        <p class="text-sm text-muted-foreground">{{ t('publicShelf.notFound') }}</p>
      </div>

      <p v-else-if="shelf && shelf.books.length === 0" class="text-center text-sm text-muted-foreground">
        {{ t('publicShelf.empty') }}
      </p>

      <div v-else-if="shelf" class="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        <article v-for="book in shelf.books" :key="book.bookId" class="group flex flex-col">
          <div
            class="relative aspect-[2/3] overflow-hidden rounded-lg border border-border bg-muted/40 shadow-sm transition-transform duration-200 group-hover:-translate-y-1 group-hover:shadow-md"
          >
            <img
              v-if="book.hasCover"
              :src="publicShelfCoverUrl(shelf.userId, book.bookId)"
              :alt="book.title"
              class="h-full w-full object-cover"
              loading="lazy"
            />
            <div v-else class="flex h-full w-full items-center justify-center bg-gradient-to-br from-muted to-muted/60">
              <BookOpen :size="28" class="text-muted-foreground" aria-hidden="true" />
            </div>
            <div
              v-if="hasAnyProgress && book.progressPercent != null && book.progressPercent > 0"
              class="absolute inset-x-0 bottom-0 h-1.5 bg-black/40"
            >
              <div class="h-full bg-primary" :style="{ width: `${Math.min(100, book.progressPercent)}%` }" :title="`${book.progressPercent}%`" />
            </div>
          </div>

          <div class="mt-2.5 min-w-0 flex-1">
            <h2 class="truncate text-sm font-medium leading-snug" :title="book.title">{{ book.title }}</h2>
            <div class="mt-1 flex items-center gap-2">
              <span v-if="hasAnyRating && book.rating" class="inline-flex items-center gap-1 text-xs text-amber-500">
                <Star :size="12" class="fill-current" aria-hidden="true" />
                {{ book.rating }}
              </span>
              <span v-if="hasAnyProgress && book.progressPercent != null && book.progressPercent > 0" class="text-xs text-muted-foreground">
                {{ book.progressPercent }}%
              </span>
            </div>
          </div>
        </article>
      </div>
    </div>

    <footer class="mx-auto max-w-5xl px-4 pb-8 text-center">
      <p class="text-xs text-muted-foreground">{{ t('publicShelf.footer') }}</p>
    </footer>
  </main>
</template>
