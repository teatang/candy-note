import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

/**
 * 创建前端路由实例并配置认证及管理员权限守卫
 */
export function createAppRouter() {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      {
        path: '/login',
        name: 'login',
        component: () => import('@/views/LoginView.vue'),
        meta: { guestOnly: true }
      },
      {
        path: '/',
        name: 'workspace',
        component: () => import('@/views/WorkspaceView.vue'),
        meta: { requiresAuth: true }
      },
      {
        path: '/admin',
        name: 'admin',
        component: () => import('@/views/AdminView.vue'),
        meta: { requiresAuth: true, requiresAdmin: true }
      },
      {
        path: '/:pathMatch(.*)*',
        redirect: '/'
      }
    ]
  })

  router.beforeEach(async (to) => {
    const authStore = useAuthStore()
    if (!authStore.initialized) {
      await authStore.fetchSession()
    }

    if (to.meta.requiresAuth && !authStore.isAuthenticated) {
      return { name: 'login', query: { redirect: to.fullPath } }
    }

    if (to.meta.guestOnly && authStore.isAuthenticated) {
      return { name: 'workspace' }
    }

    if (to.meta.requiresAdmin && !authStore.isAdmin) {
      return { name: 'workspace' }
    }

    return true
  })

  return router
}

export const router = createAppRouter()
