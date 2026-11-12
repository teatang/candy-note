import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authApi } from '@/api/auth'
import { useAuthStore } from '@/stores/auth'
import type { User } from '@/types'

/**
 * 用户认证 Store 与登录前后长时间自动登录流程单元测试
 */
describe('Auth Store', () => {
  const mockUser: User = {
    id: 'u-1',
    username: 'Candy',
    email: 'candy@example.com',
    role: 'user',
    status: 'active',
    mustChangePassword: false,
    createdAt: 1000,
    updatedAt: 1000,
    lastLoginAt: 2000
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  it('未勾选记住登录时，登录成功后应展示一键开启 30 天自动登录提示并支持开启', async () => {
    vi.spyOn(authApi, 'login').mockResolvedValue({
      user: mockUser,
      session: { id: 's-1', rememberMe: false, expiresAt: 100000 }
    })
    vi.spyOn(authApi, 'extendSession').mockResolvedValue({
      session: { id: 's-1', rememberMe: true, expiresAt: 9999999 }
    })
    vi.spyOn(authApi, 'logout').mockResolvedValue({ ok: true })

    const store = useAuthStore()
    await store.login({
      identifier: 'Candy',
      password: 'secret',
      captchaId: 'cap-1',
      captchaCode: 'ABCD',
      rememberMe: false
    })

    expect(store.isAuthenticated).toBe(true)
    expect(store.isAutoLoginEnabled).toBe(false)
    expect(store.showAutoLoginBanner).toBe(true)

    await store.extendSession(true)
    expect(store.isAutoLoginEnabled).toBe(true)
    expect(store.showAutoLoginBanner).toBe(false)

    await store.logout()
    expect(store.isAuthenticated).toBe(false)
    expect(store.user).toBeNull()
  })

  it('登录时已勾选长时间自动登录，登录后不再重复弹出横幅', async () => {
    vi.spyOn(authApi, 'login').mockResolvedValue({
      user: mockUser,
      session: { id: 's-2', rememberMe: true, expiresAt: 9999999 }
    })

    const store = useAuthStore()
    await store.login({
      identifier: 'candy@example.com',
      password: 'secret',
      captchaId: 'cap-2',
      captchaCode: 'EFGH',
      rememberMe: true
    })

    expect(store.isAutoLoginEnabled).toBe(true)
    expect(store.showAutoLoginBanner).toBe(false)
  })
})
