import { Hono } from 'hono'
import { ensureInitialAdmin, toSafeUser } from '../db/repository'
import { ensureDatabaseSchema, isNoSuchTableError } from '../db/schema'
import { extractSessionToken, requireAuth } from '../middleware/auth'
import type { AppEnv, UserRow } from '../types'
import { apiError } from '../types'
import { generateCaptchaCode, renderCaptchaSvg, svgToDataUri } from '../utils/captcha'
import {
  generateId,
  generateSessionToken,
  hashPassword,
  sha256Hex,
  verifyPassword
} from '../utils/crypto'
import {
  CAPTCHA_TTL_MS,
  isValidPassword,
  SESSION_COOKIE_NAME,
  SESSION_LONG_MS,
  SESSION_SHORT_MS
} from '../utils/validation'

/**
 * 认证与会话管理路由模块
 * - 获取图片验证码
 * - 用户名（昵称或邮箱）+ 密码 + 验证码登录
 * - 长时间自动登录（30天免登录）切换与续期
 * - 显式禁用前台自助注册接口
 */
export const authRoutes = new Hono<AppEnv>()

/**
 * 构造会话 Set-Cookie 字符串
 */
function buildSessionCookie(
  requestUrl: string,
  token: string,
  rememberMe: boolean
): string {
  const isHttps = requestUrl.startsWith('https://')
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax'
  ]
  if (isHttps) {
    parts.push('Secure')
  }
  // 勾选长时间自动登录时写入 30 天持久化 Max-Age，否则作为浏览器会话 Cookie
  if (rememberMe) {
    parts.push(`Max-Age=${Math.floor(SESSION_LONG_MS / 1000)}`)
  }
  return parts.join('; ')
}

/**
 * 构造清除会话 Cookie 字符串
 */
function buildClearSessionCookie(requestUrl: string): string {
  const isHttps = requestUrl.startsWith('https://')
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0'
  ]
  if (isHttps) {
    parts.push('Secure')
  }
  return parts.join('; ')
}

/**
 * GET /api/auth/captcha
 * 生成一次性 SVG 图片验证码，并将哈希存入 D1
 */
authRoutes.get('/captcha', async (c) => {
  await ensureInitialAdmin(c.env.DB, c.env)

  const now = Date.now()
  const captchaId = generateId()
  const code = generateCaptchaCode(4)
  const codeHash = await sha256Hex(`${captchaId}:${code.toUpperCase()}`)
  const expiresAt = now + CAPTCHA_TTL_MS

  // 惰性清理过期验证码后写入新验证码；若表结构尚未初始化则自动建表并重试
  const writeCaptcha = () =>
    c.env.DB.batch([
      c.env.DB.prepare(`DELETE FROM captchas WHERE expires_at < ?`).bind(now),
      c.env.DB.prepare(
        `INSERT INTO captchas (id, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?)`
      ).bind(captchaId, codeHash, expiresAt, now)
    ])

  try {
    await writeCaptcha()
  } catch (err) {
    if (!isNoSuchTableError(err)) {
      throw err
    }
    await ensureDatabaseSchema(c.env.DB)
    await writeCaptcha()
  }

  const svg = renderCaptchaSvg(code)
  return c.json({
    ok: true,
    captchaId,
    image: svgToDataUri(svg),
    expiresAt
  })
})

/**
 * POST /api/auth/register
 * 系统不支持前台注册，统一返回 403 提示联系管理员在后台添加账号
 */
authRoutes.post('/register', (c) => {
  return apiError(c, 403, 'AUTH_REGISTRATION_DISABLED', '不支持前台注册，请联系管理员在后台添加用户')
})

/**
 * POST /api/auth/login
 * 支持昵称或邮箱登录，必须校验图片验证码，可选开启 30 天长时间自动登录
 */
authRoutes.post('/login', async (c) => {
  await ensureInitialAdmin(c.env.DB, c.env)

  const body = await c.req
    .json<{
      identifier?: string
      password?: string
      captchaId?: string
      captchaCode?: string
      rememberMe?: boolean
    }>()
    .catch(() => null)

  if (!body) {
    return apiError(c, 400, 'VALIDATION_ERROR', '请求体格式错误')
  }

  const identifier = (body.identifier || '').trim()
  const password = body.password || ''
  const captchaId = (body.captchaId || '').trim()
  const captchaCode = (body.captchaCode || '').trim().toUpperCase()
  const rememberMe = Boolean(body.rememberMe)

  if (!identifier || !password || !captchaId || !captchaCode) {
    return apiError(c, 400, 'VALIDATION_ERROR', '请完整填写用户名/邮箱、密码和验证码')
  }

  // 查询并立即消费验证码（防止重放和暴力枚举）
  const captchaRow = await c.env.DB.prepare(
    `SELECT id, code_hash, expires_at FROM captchas WHERE id = ? LIMIT 1`
  )
    .bind(captchaId)
    .first<{ id: string; code_hash: string; expires_at: number }>()

  if (captchaRow) {
    await c.env.DB.prepare(`DELETE FROM captchas WHERE id = ?`).bind(captchaId).run()
  }

  const now = Date.now()
  if (!captchaRow) {
    return apiError(c, 400, 'AUTH_INVALID_CAPTCHA', '验证码无效或已使用，请刷新后重试')
  }

  if (captchaRow.expires_at < now) {
    return apiError(c, 400, 'AUTH_CAPTCHA_EXPIRED', '验证码已过期，请刷新后重试')
  }

  const submittedHash = await sha256Hex(`${captchaId}:${captchaCode}`)
  if (submittedHash !== captchaRow.code_hash) {
    return apiError(c, 400, 'AUTH_INVALID_CAPTCHA', '图片验证码错误，请重新输入')
  }

  // 支持使用昵称 (username) 或邮箱 (email) 登录
  const user = await c.env.DB.prepare(
    `SELECT * FROM users WHERE username = ? OR email = ? LIMIT 1`
  )
    .bind(identifier, identifier.toLowerCase())
    .first<UserRow>()

  if (!user) {
    return apiError(c, 401, 'AUTH_INVALID_CREDENTIALS', '用户名/邮箱或密码错误')
  }

  const passwordValid = await verifyPassword(password, user.password_hash)
  if (!passwordValid) {
    return apiError(c, 401, 'AUTH_INVALID_CREDENTIALS', '用户名/邮箱或密码错误')
  }

  if (user.status !== 'active') {
    return apiError(c, 403, 'AUTH_USER_DISABLED', '该账号已被禁用，请联系管理员')
  }

  const sessionToken = generateSessionToken()
  const tokenHash = await sha256Hex(sessionToken)
  const sessionId = generateId()
  const ttl = rememberMe ? SESSION_LONG_MS : SESSION_SHORT_MS
  const expiresAt = now + ttl
  const userAgent = (c.req.header('user-agent') || '').slice(0, 200)

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, remember_me, user_agent, created_at, expires_at, last_active_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(sessionId, user.id, tokenHash, rememberMe ? 1 : 0, userAgent, now, expiresAt, now),
    c.env.DB.prepare(`UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?`).bind(
      now,
      now,
      user.id
    )
  ])

  const updatedUser: UserRow = { ...user, last_login_at: now, updated_at: now }
  c.header('Set-Cookie', buildSessionCookie(c.req.url, sessionToken, rememberMe))

  return c.json({
    ok: true,
    user: toSafeUser(updatedUser),
    session: {
      id: sessionId,
      rememberMe,
      expiresAt
    }
  })
})

/**
 * GET /api/auth/me
 * 获取当前已登录用户信息与会话自动登录状态
 */
authRoutes.get('/me', requireAuth, (c) => {
  const user = c.get('user')
  const session = c.get('session')
  return c.json({
    ok: true,
    user,
    session: {
      id: session.id,
      rememberMe: session.remember_me === 1,
      expiresAt: session.expires_at
    }
  })
})

/**
 * POST /api/auth/extend-session
 * 登录成功后可选择开启或关闭“长时间自动登录（30天免登录）”
 */
authRoutes.post('/extend-session', requireAuth, async (c) => {
  const session = c.get('session')
  const body = await c.req.json<{ rememberMe?: boolean }>().catch(() => null)
  const rememberMe = body?.rememberMe !== undefined ? Boolean(body.rememberMe) : true

  const token = extractSessionToken(c.req.raw)
  if (!token) {
    return apiError(c, 401, 'AUTH_UNAUTHORIZED', '会话无效')
  }

  const now = Date.now()
  const expiresAt = now + (rememberMe ? SESSION_LONG_MS : SESSION_SHORT_MS)

  await c.env.DB.prepare(
    `UPDATE sessions SET remember_me = ?, expires_at = ?, last_active_at = ? WHERE id = ?`
  )
    .bind(rememberMe ? 1 : 0, expiresAt, now, session.id)
    .run()

  c.header('Set-Cookie', buildSessionCookie(c.req.url, token, rememberMe))

  return c.json({
    ok: true,
    session: {
      id: session.id,
      rememberMe,
      expiresAt
    }
  })
})

/**
 * POST /api/auth/change-password
 * 已登录用户修改个人登录密码
 */
authRoutes.post('/change-password', requireAuth, async (c) => {
  const user = c.get('user')
  const body = await c.req
    .json<{ currentPassword?: string; newPassword?: string }>()
    .catch(() => null)

  if (!body?.currentPassword || !body?.newPassword) {
    return apiError(c, 400, 'VALIDATION_ERROR', '请输入当前密码与新密码')
  }

  if (!isValidPassword(body.newPassword)) {
    return apiError(c, 400, 'VALIDATION_ERROR', '新密码长度需在 6 至 128 个字符之间')
  }

  const userRow = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ? LIMIT 1`)
    .bind(user.id)
    .first<UserRow>()

  if (!userRow || !(await verifyPassword(body.currentPassword, userRow.password_hash))) {
    return apiError(c, 401, 'AUTH_INVALID_CREDENTIALS', '当前密码不正确')
  }

  const newHash = await hashPassword(body.newPassword)
  const now = Date.now()
  await c.env.DB.prepare(
    `UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?`
  )
    .bind(newHash, now, user.id)
    .run()

  return c.json({ ok: true })
})

/**
 * POST /api/auth/logout
 * 退出登录并销毁服务器端会话记录
 */
authRoutes.post('/logout', async (c) => {
  const token = extractSessionToken(c.req.raw)
  if (token) {
    const tokenHash = await sha256Hex(token)
    try {
      await c.env.DB.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(tokenHash).run()
    } catch (err) {
      if (!isNoSuchTableError(err)) {
        throw err
      }
      await ensureDatabaseSchema(c.env.DB)
    }
  }
  c.header('Set-Cookie', buildClearSessionCookie(c.req.url))
  return c.json({ ok: true })
})
