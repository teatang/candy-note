import type { CaptchaPayload, SessionInfo, User } from '@/types'
import { apiRequest } from './client'

/** 认证相关接口封装 */
export const authApi = {
  /** 获取图片验证码 */
  getCaptcha() {
    return apiRequest<CaptchaPayload>('/api/auth/captcha', {
      method: 'GET',
      skipUnauthorizedCallback: true
    })
  },

  /** 登录（支持昵称或邮箱 + 密码 + 验证码 + 长时间自动登录） */
  login(payload: {
    identifier: string
    password: string
    captchaId: string
    captchaCode: string
    rememberMe: boolean
  }) {
    return apiRequest<{ user: User; session: SessionInfo }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
      skipUnauthorizedCallback: true
    })
  },

  /** 获取当前登录用户及会话状态 */
  me() {
    return apiRequest<{ user: User; session: SessionInfo }>('/api/auth/me', {
      method: 'GET',
      skipUnauthorizedCallback: true
    })
  },

  /** 登录成功后开启或关闭 30 天长时间自动登录 */
  extendSession(rememberMe: boolean) {
    return apiRequest<{ session: SessionInfo }>('/api/auth/extend-session', {
      method: 'POST',
      body: JSON.stringify({ rememberMe })
    })
  },

  /** 修改当前用户密码 */
  changePassword(currentPassword: string, newPassword: string) {
    return apiRequest<{ ok: true }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword })
    })
  },

  /** 退出登录 */
  logout() {
    return apiRequest<{ ok: true }>('/api/auth/logout', {
      method: 'POST',
      skipUnauthorizedCallback: true
    })
  }
}
