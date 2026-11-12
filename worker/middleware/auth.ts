import type { MiddlewareHandler } from 'hono'
import { ensureInitialAdmin, toSafeUser } from '../db/repository'
import { ensureDatabaseSchema, isNoSuchTableError } from '../db/schema'
import type { AppEnv, SessionRow, UserRow } from '../types'
import { apiError } from '../types'
import { sha256Hex } from '../utils/crypto'
import { parseCookieValue, SESSION_COOKIE_NAME } from '../utils/validation'

/** 活跃时间刷新节流间隔：5 分钟（节省 D1 免费额度写入次数） */
const LAST_ACTIVE_THROTTLE_MS = 5 * 60 * 1000

/**
 * 从请求头或 Cookie 中提取会话令牌
 * 优先读取 HttpOnly Cookie，其次兼容 Authorization Bearer 头
 */
export function extractSessionToken(req: Request): string | null {
  const cookieToken = parseCookieValue(req.headers.get('cookie') ?? undefined, SESSION_COOKIE_NAME)
  if (cookieToken) return cookieToken

  const authHeader = req.headers.get('authorization')
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim()
    return token || null
  }
  return null
}

/**
 * 认证中间件：校验用户会话 Cookie 并加载当前活跃用户信息
 */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  await ensureInitialAdmin(c.env.DB, c.env)

  const token = extractSessionToken(c.req.raw)
  if (!token) {
    return apiError(c, 401, 'AUTH_UNAUTHORIZED', '未登录或会话已失效')
  }

  const tokenHash = await sha256Hex(token)
  const now = Date.now()

  const querySession = () =>
    c.env.DB.prepare(
      `SELECT
         s.id AS s_id, s.user_id AS s_user_id, s.token_hash AS s_token_hash,
         s.remember_me AS s_remember_me, s.user_agent AS s_user_agent,
         s.created_at AS s_created_at, s.expires_at AS s_expires_at, s.last_active_at AS s_last_active_at,
         u.id AS u_id, u.username AS u_username, u.email AS u_email, u.password_hash AS u_password_hash,
         u.role AS u_role, u.status AS u_status, u.must_change_password AS u_must_change_password,
         u.created_at AS u_created_at, u.updated_at AS u_updated_at, u.last_login_at AS u_last_login_at
       FROM sessions s
       INNER JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?
       LIMIT 1`
    )
      .bind(tokenHash)
      .first<Record<string, unknown>>()

  let row: Record<string, unknown> | null = null
  try {
    row = await querySession()
  } catch (err) {
    if (!isNoSuchTableError(err)) {
      throw err
    }
    await ensureDatabaseSchema(c.env.DB)
    await ensureInitialAdmin(c.env.DB, c.env)
    row = await querySession()
  }

  if (!row) {
    return apiError(c, 401, 'AUTH_UNAUTHORIZED', '登录会话无效，请重新登录')
  }

  const session: SessionRow = {
    id: String(row.s_id),
    user_id: String(row.s_user_id),
    token_hash: String(row.s_token_hash),
    remember_me: Number(row.s_remember_me),
    user_agent: (row.s_user_agent as string | null) ?? null,
    created_at: Number(row.s_created_at),
    expires_at: Number(row.s_expires_at),
    last_active_at: Number(row.s_last_active_at)
  }

  if (session.expires_at <= now) {
    await c.env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(session.id).run()
    return apiError(c, 401, 'AUTH_UNAUTHORIZED', '登录已过期，请重新登录')
  }

  const userRow: UserRow = {
    id: String(row.u_id),
    username: String(row.u_username),
    email: String(row.u_email),
    password_hash: String(row.u_password_hash),
    role: row.u_role as UserRow['role'],
    status: row.u_status as UserRow['status'],
    must_change_password: Number(row.u_must_change_password),
    created_at: Number(row.u_created_at),
    updated_at: Number(row.u_updated_at),
    last_login_at: row.u_last_login_at === null ? null : Number(row.u_last_login_at)
  }

  if (userRow.status !== 'active') {
    return apiError(c, 403, 'AUTH_USER_DISABLED', '账号已被管理员禁用')
  }

  // 节流更新最后活跃时间，减少免费版 D1 写入消耗
  if (now - session.last_active_at > LAST_ACTIVE_THROTTLE_MS) {
    await c.env.DB.prepare(`UPDATE sessions SET last_active_at = ? WHERE id = ?`)
      .bind(now, session.id)
      .run()
    session.last_active_at = now
  }

  c.set('user', toSafeUser(userRow))
  c.set('session', session)
  await next()
}

/**
 * 管理员权限守卫中间件：必须先经过 requireAuth
 */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get('user')
  if (!user || user.role !== 'admin') {
    return apiError(c, 403, 'AUTH_FORBIDDEN', '仅管理员有权限访问后台')
  }
  await next()
}
