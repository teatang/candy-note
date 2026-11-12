import { describe, expect, it } from 'vitest'
import { SESSION_LONG_MS, SESSION_SHORT_MS } from '@worker/utils/validation'
import { createTestHarness } from '../helpers/testApp'

/**
 * 用户登录认证、禁用注册与长时间自动登录单元测试
 */
describe('Auth & Long-Term Auto-Login API', () => {
  it('应禁止前台自主注册账号', async () => {
    const harness = createTestHarness()
    try {
      const res = await harness.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'hacker', email: 'h@example.com', password: 'Password123' })
      })
      expect(res.status).toBe(403)
      const body = (await res.json()) as { code: string }
      expect(body.code).toBe('AUTH_REGISTRATION_DISABLED')
    } finally {
      harness.db.close()
    }
  })

  it('支持使用昵称或邮箱登录（验证码不区分大小写），并在登录前后切换 30 天长时间自动登录', async () => {
    const harness = createTestHarness()
    try {
      // 先以管理员身份手动创建一个普通测试用户
      const adminSession = await harness.loginAsAdmin(false)
      expect(adminSession.response.status).toBe(200)

      const createUserRes = await harness.request(
        '/api/admin/users',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: 'SweetCandy',
            email: 'sweet@candynote.dev',
            password: 'UserPass123!',
            role: 'user',
            status: 'active'
          })
        },
        adminSession.cookie
      )
      expect(createUserRes.status).toBe(201)

      // 1) 使用昵称 + 小写验证码 + 标准会话登录
      const captcha1 = await harness.fetchCaptcha()
      const loginByUsername = await harness.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: 'SweetCandy',
          password: 'UserPass123!',
          captchaId: captcha1.captchaId,
          captchaCode: captcha1.code.toLowerCase(),
          rememberMe: false
        })
      })
      expect(loginByUsername.status).toBe(200)
      const cookie1 = (loginByUsername.headers.get('set-cookie') || '').split(';')[0]
      expect(loginByUsername.headers.get('set-cookie')).not.toContain('Max-Age=2592000')
      const body1 = (await loginByUsername.json()) as {
        session: { rememberMe: boolean; expiresAt: number }
      }
      expect(body1.session.rememberMe).toBe(false)
      expect(body1.session.expiresAt - Date.now()).toBeLessThanOrEqual(SESSION_SHORT_MS + 5000)

      // 2) 登录成功后通过 /api/auth/extend-session 开启 30 天长时间自动登录
      const extendRes = await harness.request(
        '/api/auth/extend-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rememberMe: true })
        },
        cookie1
      )
      expect(extendRes.status).toBe(200)
      expect(extendRes.headers.get('set-cookie')).toContain('Max-Age=2592000')
      const extendBody = (await extendRes.json()) as {
        session: { rememberMe: boolean; expiresAt: number }
      }
      expect(extendBody.session.rememberMe).toBe(true)
      expect(extendBody.session.expiresAt - Date.now()).toBeGreaterThan(SESSION_LONG_MS - 60000)

      // 3) 使用注册邮箱 + rememberMe: true 直接登录
      const loginByEmail = await harness.login('SWEET@candynote.dev', 'UserPass123!', true)
      expect(loginByEmail.response.status).toBe(200)
      expect(loginByEmail.response.headers.get('set-cookie')).toContain('Max-Age=2592000')

      // 4) 退出登录后原会话应立即失效
      const logoutRes = await harness.request('/api/auth/logout', { method: 'POST' }, cookie1)
      expect(logoutRes.status).toBe(200)

      const meAfterLogout = await harness.request('/api/auth/me', {}, cookie1)
      expect(meAfterLogout.status).toBe(401)
    } finally {
      harness.db.close()
    }
  })

  it('被管理员禁用的用户无法登录', async () => {
    const harness = createTestHarness()
    try {
      const admin = await harness.loginAsAdmin()
      await harness.request(
        '/api/admin/users',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: 'BlockedUser',
            email: 'blocked@candynote.dev',
            password: 'Password123!',
            role: 'user',
            status: 'disabled'
          })
        },
        admin.cookie
      )

      const res = await harness.login('BlockedUser', 'Password123!')
      expect(res.response.status).toBe(403)
      expect(res.body.code).toBe('AUTH_USER_DISABLED')
    } finally {
      harness.db.close()
    }
  })
})
