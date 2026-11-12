import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { authApi } from '@/api/auth'
import type { SessionInfo, User } from '@/types'

/**
 * 全局用户认证与会话状态仓库
 * 管理当前登录用户信息、长效自动登录状态（30天）及密码修改
 */
export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const session = ref<SessionInfo | null>(null)
  const initialized = ref(false)
  const loading = ref(false)
  /** 登录成功后若尚未开启长时间自动登录，可在工作区顶部提示用户一键开启 */
  const showAutoLoginBanner = ref(false)

  const isAuthenticated = computed(() => user.value !== null)
  const isAdmin = computed(() => user.value?.role === 'admin')
  const isAutoLoginEnabled = computed(() => Boolean(session.value?.rememberMe))

  /** 初始化或刷新当前会话信息 */
  async function fetchSession() {
    loading.value = true
    try {
      const res = await authApi.me()
      user.value = res.user
      session.value = res.session
    } catch {
      user.value = null
      session.value = null
    } finally {
      initialized.value = true
      loading.value = false
    }
  }

  /** 提交登录表单（用户名/邮箱 + 密码 + 验证码 + 自动登录选项） */
  async function login(payload: {
    identifier: string
    password: string
    captchaId: string
    captchaCode: string
    rememberMe: boolean
  }) {
    loading.value = true
    try {
      const res = await authApi.login(payload)
      user.value = res.user
      session.value = res.session
      initialized.value = true
      // 若登录时未勾选自动登录，登录成功后提示用户可按需开启长时间自动登录
      showAutoLoginBanner.value = !res.session.rememberMe
      return res
    } finally {
      loading.value = false
    }
  }

  /** 登录成功后动态开启或关闭 30 天长时间自动登录 */
  async function extendSession(rememberMe: boolean) {
    const res = await authApi.extendSession(rememberMe)
    session.value = res.session
    if (rememberMe) {
      showAutoLoginBanner.value = false
    }
    return res.session
  }

  /** 关闭自动登录提醒横幅 */
  function dismissAutoLoginBanner() {
    showAutoLoginBanner.value = false
  }

  /** 修改当前用户密码 */
  async function changePassword(currentPassword: string, newPassword: string) {
    await authApi.changePassword(currentPassword, newPassword)
    if (user.value) {
      user.value = { ...user.value, mustChangePassword: false }
    }
  }

  /** 退出登录并清空本地认证态 */
  async function logout() {
    try {
      await authApi.logout()
    } finally {
      user.value = null
      session.value = null
      showAutoLoginBanner.value = false
    }
  }

  /** 强制清除本地会话态（用于接口返回 401 时） */
  function clearLocalAuth() {
    user.value = null
    session.value = null
    showAutoLoginBanner.value = false
  }

  return {
    user,
    session,
    initialized,
    loading,
    showAutoLoginBanner,
    isAuthenticated,
    isAdmin,
    isAutoLoginEnabled,
    fetchSession,
    login,
    extendSession,
    dismissAutoLoginBanner,
    changePassword,
    logout,
    clearLocalAuth
  }
})
