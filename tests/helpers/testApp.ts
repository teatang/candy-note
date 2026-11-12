import { createApp } from '@worker/index'
import type { Env } from '@worker/types'
import { MockD1Database } from './mockD1'
import { MockR2Bucket } from './mockR2'

/**
 * 从验证码接口返回的 Base64 SVG Data URI 中解析出明文字符（用于真实端到端测试）
 */
export function decodeCaptchaTextFromDataUri(dataUri: string): string {
  const base64 = dataUri.replace(/^data:image\/svg\+xml;base64,/, '')
  const svg = Buffer.from(base64, 'base64').toString('utf-8')
  const matches: RegExpExecArray[] = Array.from(svg.matchAll(/<text[^>]*>([^<]+)<\/text>/g))
  return matches.map((m) => m[1]).join('')
}

/**
 * 创建隔离的 Worker 测试环境上下文（独立内存 SQLite D1 + 内存 R2）
 */
export function createTestHarness(envOverrides: Partial<Env> = {}) {
  const db = new MockD1Database()
  const r2 = new MockR2Bucket()
  const app = createApp()

  const env: Env = {
    DB: db as unknown as D1Database,
    R2_BUCKET: r2 as unknown as R2Bucket,
    DEFAULT_ADMIN_USERNAME: 'admin',
    DEFAULT_ADMIN_EMAIL: 'admin@candynote.local',
    DEFAULT_ADMIN_PASSWORD: 'TestAdminPassword123!',
    ...envOverrides
  }

  async function request(path: string, init: RequestInit = {}, cookie?: string): Promise<Response> {
    const headers = new Headers(init.headers)
    if (cookie) {
      headers.set('cookie', cookie)
    }
    const req = new Request(`http://localhost${path}`, { ...init, headers })
    return app.fetch(req, env)
  }

  async function fetchCaptcha(): Promise<{ captchaId: string; code: string; image: string }> {
    const res = await request('/api/auth/captcha')
    const data = (await res.json()) as { captchaId: string; image: string }
    return {
      captchaId: data.captchaId,
      image: data.image,
      code: decodeCaptchaTextFromDataUri(data.image)
    }
  }

  async function login(
    identifier: string,
    password: string,
    rememberMe = false
  ): Promise<{ response: Response; cookie: string; body: Record<string, unknown> }> {
    const captcha = await fetchCaptcha()
    const response = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier,
        password,
        captchaId: captcha.captchaId,
        captchaCode: captcha.code,
        rememberMe
      })
    })
    const setCookie = response.headers.get('set-cookie') || ''
    const cookie = setCookie.split(';')[0] || ''
    const body = (await response.json()) as Record<string, unknown>
    return { response, cookie, body }
  }

  async function loginAsAdmin(rememberMe = false) {
    return login(
      env.DEFAULT_ADMIN_USERNAME || 'admin',
      env.DEFAULT_ADMIN_PASSWORD || 'TestAdminPassword123!',
      rememberMe
    )
  }

  return {
    db,
    r2,
    env,
    app,
    request,
    fetchCaptcha,
    login,
    loginAsAdmin
  }
}
