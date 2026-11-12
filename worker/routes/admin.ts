import { Hono } from 'hono'
import { toSafeUser } from '../db/repository'
import { requireAdmin, requireAuth } from '../middleware/auth'
import type { AppEnv, AttachmentRow, UserRole, UserRow, UserStatus } from '../types'
import { apiError } from '../types'
import { generateId, hashPassword } from '../utils/crypto'
import {
  isValidEmail,
  isValidPassword,
  isValidUsername,
  SEVEN_DAYS_MS
} from '../utils/validation'

/**
 * 管理后台路由模块（严格限制 role === 'admin' 访问）
 * - 查看系统主要信息统计（用户数、笔记/格式分布、文件夹数、7天版本数、R2 存储占用）
 * - 手动添加用户、编辑用户、重置密码、启用/禁用账号、删除用户并回收 R2 存储
 */
export const adminRoutes = new Hono<AppEnv>()

adminRoutes.use('*', requireAuth, requireAdmin)

/**
 * GET /api/admin/stats
 * 获取管理后台系统概览主要信息与各用户资源用量统计
 */
adminRoutes.get('/stats', async (c) => {
  const sevenDaysAgo = Date.now() - SEVEN_DAYS_MS

  const userStats = await c.env.DB.prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
       SUM(CASE WHEN status = 'disabled' THEN 1 ELSE 0 END) AS disabled,
       SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) AS admins
     FROM users`
  ).first<{ total: number; active: number; disabled: number; admins: number }>()

  const noteStats = await c.env.DB.prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN format = 'markdown' THEN 1 ELSE 0 END) AS markdown,
       SUM(CASE WHEN format = 'plain' THEN 1 ELSE 0 END) AS plain,
       SUM(CASE WHEN is_pinned = 1 THEN 1 ELSE 0 END) AS pinned
     FROM notes`
  ).first<{ total: number; markdown: number; plain: number; pinned: number }>()

  const folderStats = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total FROM folders`
  ).first<{ total: number }>()

  const versionStats = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total FROM note_versions WHERE created_at >= ?`
  )
    .bind(sevenDaysAgo)
    .first<{ total: number }>()

  const attachmentStats = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total_count, COALESCE(SUM(size), 0) AS total_size FROM attachments`
  ).first<{ total_count: number; total_size: number }>()

  const { results: recentLoginRows } = await c.env.DB.prepare(
    `SELECT * FROM users WHERE last_login_at IS NOT NULL ORDER BY last_login_at DESC LIMIT 8`
  ).all<UserRow>()

  const { results: userSummaries } = await c.env.DB.prepare(
    `SELECT
       u.id, u.username, u.email, u.role, u.status, u.last_login_at, u.created_at,
       (SELECT COUNT(*) FROM notes n WHERE n.user_id = u.id) AS note_count,
       (SELECT COUNT(*) FROM folders f WHERE f.user_id = u.id) AS folder_count,
       (SELECT COUNT(*) FROM attachments a WHERE a.user_id = u.id) AS attachment_count,
       (SELECT COALESCE(SUM(a.size), 0) FROM attachments a WHERE a.user_id = u.id) AS storage_bytes
     FROM users u
     ORDER BY u.created_at DESC`
  ).all<{
    id: string
    username: string
    email: string
    role: UserRole
    status: UserStatus
    last_login_at: number | null
    created_at: number
    note_count: number
    folder_count: number
    attachment_count: number
    storage_bytes: number
  }>()

  return c.json({
    ok: true,
    stats: {
      users: {
        total: Number(userStats?.total ?? 0),
        active: Number(userStats?.active ?? 0),
        disabled: Number(userStats?.disabled ?? 0),
        admins: Number(userStats?.admins ?? 0)
      },
      notes: {
        total: Number(noteStats?.total ?? 0),
        markdown: Number(noteStats?.markdown ?? 0),
        plain: Number(noteStats?.plain ?? 0),
        pinned: Number(noteStats?.pinned ?? 0)
      },
      folders: {
        total: Number(folderStats?.total ?? 0)
      },
      versions: {
        totalLast7Days: Number(versionStats?.total ?? 0)
      },
      attachments: {
        totalCount: Number(attachmentStats?.total_count ?? 0),
        totalSizeBytes: Number(attachmentStats?.total_size ?? 0)
      },
      recentLogins: recentLoginRows.map(toSafeUser),
      userSummaries: userSummaries.map((u) => ({
        id: u.id,
        username: u.username,
        email: u.email,
        role: u.role,
        status: u.status,
        lastLoginAt: u.last_login_at,
        createdAt: u.created_at,
        noteCount: Number(u.note_count),
        folderCount: Number(u.folder_count),
        attachmentCount: Number(u.attachment_count),
        storageBytes: Number(u.storage_bytes)
      }))
    }
  })
})

/**
 * GET /api/admin/users
 * 查询系统用户列表（支持关键词和状态过滤）
 */
adminRoutes.get('/users', async (c) => {
  const q = (c.req.query('q') || '').trim().toLowerCase()
  const status = c.req.query('status')

  const conditions: string[] = ['1 = 1']
  const bindings: unknown[] = []

  if (q) {
    conditions.push('(LOWER(username) LIKE ? OR LOWER(email) LIKE ?)')
    bindings.push(`%${q}%`, `%${q}%`)
  }
  if (status === 'active' || status === 'disabled') {
    conditions.push('status = ?')
    bindings.push(status)
  }

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM users WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`
  )
    .bind(...bindings)
    .all<UserRow>()

  return c.json({
    ok: true,
    users: results.map(toSafeUser)
  })
})

/**
 * POST /api/admin/users
 * 管理员手动添加新用户（系统唯一的用户创建入口）
 */
adminRoutes.post('/users', async (c) => {
  const body = await c.req
    .json<{
      username?: string
      email?: string
      password?: string
      role?: UserRole
      status?: UserStatus
    }>()
    .catch(() => null)

  const username = (body?.username || '').trim()
  const email = (body?.email || '').trim().toLowerCase()
  const password = body?.password || ''
  const role: UserRole = body?.role === 'admin' ? 'admin' : 'user'
  const status: UserStatus = body?.status === 'disabled' ? 'disabled' : 'active'

  if (!isValidUsername(username)) {
    return apiError(
      c,
      400,
      'VALIDATION_ERROR',
      '用户昵称长度需为 2-32 个字符，且不能包含 @ 或空格'
    )
  }

  if (!isValidEmail(email)) {
    return apiError(c, 400, 'VALIDATION_ERROR', '请输入合法的电子邮箱地址')
  }

  if (!isValidPassword(password)) {
    return apiError(c, 400, 'VALIDATION_ERROR', '密码长度需在 6 至 128 个字符之间')
  }

  const conflict = await c.env.DB.prepare(
    `SELECT id FROM users WHERE username = ? OR email = ? LIMIT 1`
  )
    .bind(username, email)
    .first<{ id: string }>()

  if (conflict) {
    return apiError(c, 409, 'USER_CONFLICT', '该用户昵称或邮箱已存在')
  }

  const id = generateId()
  const now = Date.now()
  const passwordHash = await hashPassword(password)

  await c.env.DB.prepare(
    `INSERT INTO users (id, username, email, password_hash, role, status, must_change_password, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`
  )
    .bind(id, username, email, passwordHash, role, status, now, now)
    .run()

  return c.json(
    {
      ok: true,
      user: {
        id,
        username,
        email,
        role,
        status,
        mustChangePassword: false,
        createdAt: now,
        updatedAt: now,
        lastLoginAt: null
      }
    },
    201
  )
})

/**
 * PATCH /api/admin/users/:id
 * 管理员编辑用户信息、修改角色/状态或重置用户密码
 */
adminRoutes.patch('/users/:id', async (c) => {
  const currentAdmin = c.get('user')
  const targetId = c.req.param('id')
  const body = await c.req
    .json<{
      username?: string
      email?: string
      password?: string
      role?: UserRole
      status?: UserStatus
    }>()
    .catch(() => null)

  if (!body) {
    return apiError(c, 400, 'VALIDATION_ERROR', '请求体不能为空')
  }

  const target = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ? LIMIT 1`)
    .bind(targetId)
    .first<UserRow>()

  if (!target) {
    return apiError(c, 404, 'USER_NOT_FOUND', '用户不存在')
  }

  const nextUsername = body.username !== undefined ? body.username.trim() : target.username
  const nextEmail = body.email !== undefined ? body.email.trim().toLowerCase() : target.email
  const nextRole: UserRole =
    body.role === 'admin' || body.role === 'user' ? body.role : target.role
  const nextStatus: UserStatus =
    body.status === 'active' || body.status === 'disabled' ? body.status : target.status

  if (!isValidUsername(nextUsername)) {
    return apiError(
      c,
      400,
      'VALIDATION_ERROR',
      '用户昵称长度需为 2-32 个字符，且不能包含 @ 或空格'
    )
  }

  if (!isValidEmail(nextEmail)) {
    return apiError(c, 400, 'VALIDATION_ERROR', '请输入合法的电子邮箱地址')
  }

  // 防止管理员禁用自己或降级自己导致失去后台权限
  if (targetId === currentAdmin.id && (nextStatus !== 'active' || nextRole !== 'admin')) {
    return apiError(c, 400, 'CANNOT_MODIFY_SELF', '不能禁用当前登录管理员自身或撤销自身管理员权限')
  }

  // 保护系统中至少保留一名活跃管理员
  if (
    target.role === 'admin' &&
    target.status === 'active' &&
    (nextRole !== 'admin' || nextStatus !== 'active')
  ) {
    const adminCount = await c.env.DB.prepare(
      `SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin' AND status = 'active'`
    ).first<{ cnt: number }>()
    if (Number(adminCount?.cnt ?? 0) <= 1) {
      return apiError(c, 400, 'CANNOT_DELETE_LAST_ADMIN', '系统至少需要保留一名启用状态的管理员')
    }
  }

  const conflict = await c.env.DB.prepare(
    `SELECT id FROM users WHERE (username = ? OR email = ?) AND id != ? LIMIT 1`
  )
    .bind(nextUsername, nextEmail, targetId)
    .first<{ id: string }>()

  if (conflict) {
    return apiError(c, 409, 'USER_CONFLICT', '该用户昵称或邮箱已被其他账号使用')
  }

  let nextPasswordHash = target.password_hash
  let nextMustChange = target.must_change_password
  if (body.password && body.password.length > 0) {
    if (!isValidPassword(body.password)) {
      return apiError(c, 400, 'VALIDATION_ERROR', '密码长度需在 6 至 128 个字符之间')
    }
    nextPasswordHash = await hashPassword(body.password)
    nextMustChange = 0
  }

  const now = Date.now()
  await c.env.DB.prepare(
    `UPDATE users
     SET username = ?, email = ?, password_hash = ?, role = ?, status = ?, must_change_password = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(
      nextUsername,
      nextEmail,
      nextPasswordHash,
      nextRole,
      nextStatus,
      nextMustChange,
      now,
      targetId
    )
    .run()

  // 若账号被禁用，立即吊销其所有已登录会话
  if (nextStatus === 'disabled') {
    await c.env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(targetId).run()
  }

  return c.json({
    ok: true,
    user: toSafeUser({
      ...target,
      username: nextUsername,
      email: nextEmail,
      password_hash: nextPasswordHash,
      role: nextRole,
      status: nextStatus,
      must_change_password: nextMustChange,
      updated_at: now
    })
  })
})

/**
 * DELETE /api/admin/users/:id
 * 删除用户并同步清理其在 Cloudflare R2 中存储的所有图片附件
 */
adminRoutes.delete('/users/:id', async (c) => {
  const currentAdmin = c.get('user')
  const targetId = c.req.param('id')

  if (targetId === currentAdmin.id) {
    return apiError(c, 400, 'CANNOT_MODIFY_SELF', '不能删除当前正在登录的管理员账号')
  }

  const target = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ? LIMIT 1`)
    .bind(targetId)
    .first<UserRow>()

  if (!target) {
    return apiError(c, 404, 'USER_NOT_FOUND', '用户不存在')
  }

  if (target.role === 'admin') {
    const adminCount = await c.env.DB.prepare(
      `SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin'`
    ).first<{ cnt: number }>()
    if (Number(adminCount?.cnt ?? 0) <= 1) {
      return apiError(c, 400, 'CANNOT_DELETE_LAST_ADMIN', '不能删除系统最后一位管理员')
    }
  }

  // 先清理用户在 R2 对象存储中的图片文件
  const { results: attachments } = await c.env.DB.prepare(
    `SELECT r2_key FROM attachments WHERE user_id = ?`
  )
    .bind(targetId)
    .all<Pick<AttachmentRow, 'r2_key'>>()

  for (const att of attachments) {
    await c.env.R2_BUCKET.delete(att.r2_key)
  }

  await c.env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(targetId).run()
  return c.json({ ok: true })
})
