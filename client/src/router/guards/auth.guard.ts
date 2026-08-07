import type { Router } from 'vue-router'
import { getStoredAccessToken } from '@/lib/api'
import { offlineBooted } from '@/lib/offline/state'
import { useAuth } from '@/features/auth/composables/useAuth'
import { useChangePasswordDialog } from '@/composables/useChangePasswordDialog'
import { useSetupStatus } from '@/features/auth/composables/useSetupStatus'

/** Routes that can be used without a network connection while offline-booted. */
const OFFLINE_ROUTES = new Set(['offline', 'reader'])

export function registerAuthGuard(router: Router): void {
  router.beforeEach(async (to) => {
    const { fetchSetupStatus } = useSetupStatus()
    let requiresSetup = false
    try {
      requiresSetup = await fetchSetupStatus()
    } catch {
      // If setup-status cannot be loaded, fall back to normal auth checks.
    }
    if (requiresSetup && to.path !== '/setup') {
      return { path: '/setup' }
    }

    if (!requiresSetup && to.path === '/setup') {
      const { user } = useAuth()
      return user.value ? { path: '/' } : { path: '/login' }
    }

    if (to.meta.public) return true

    const { user } = useAuth()

    if (!user.value) {
      // Offline boot with a stored session: land on the downloaded shelf instead of the login page.
      if (offlineBooted.value && getStoredAccessToken()) {
        // Only routes that work fully offline may be visited: the downloaded shelf and the reader.
        if (typeof to.name === 'string' && OFFLINE_ROUTES.has(to.name)) return true
        return { name: 'offline' }
      }
      return { path: '/login', query: { redirect: to.fullPath } }
    }

    if (user.value.isDefaultPassword && user.value.provisioningMethod !== 'shared') {
      useChangePasswordDialog().open(true)
      // Allow navigation to '/' but block everything else
      if (to.path !== '/') return { path: '/' }
    }

    if (to.name === 'achievements' && user.value.settings.achievementPreferences?.enabled === false) {
      return { name: 'settings-account', query: { tab: 'profile' } }
    }

    return true
  })
}
