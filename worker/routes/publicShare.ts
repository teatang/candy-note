import { Hono } from 'hono'
import type { AppEnv, NoteFormat, PublicNoteShareDto } from '../types'
import { apiError } from '../types'
import { verifyPassword } from '../utils/crypto'

export const publicShareRoutes = new Hono<AppEnv>()

/**
 * 联合查询分享与笔记及作者信息的行结构
 */
interface JoinedShareNoteRow {
  s_id: string
  s_note_id: string
  s_user_id: string
  s_share_code: string
  s_is_enabled: number
  s_has_password: number
  s_password_hash: string | null
  s_expires_at: number | null
  s_view_count: number
  s_created_at: number
  n_title: string
  n_content: string
  n_format: NoteFormat
  n_created_at: number
  n_updated_at: number
  author_name: string
}

async function queryShare(db: D1Database, code: string): Promise<JoinedShareNoteRow | null> {
  const sql = `
    SELECT
      s.id AS s_id,
      s.note_id AS s_note_id,
      s.user_id AS s_user_id,
      s.share_code AS s_share_code,
      s.is_enabled AS s_is_enabled,
      s.has_password AS s_has_password,
      s.password_hash AS s_password_hash,
      s.expires_at AS s_expires_at,
      s.view_count AS s_view_count,
      s.created_at AS s_created_at,
      n.title AS n_title,
      n.content AS n_content,
      n.format AS n_format,
      n.created_at AS n_created_at,
      n.updated_at AS n_updated_at,
      u.username AS author_name
    FROM note_shares s
    INNER JOIN notes n ON n.id = s.note_id
    INNER JOIN users u ON u.id = s.user_id
    WHERE s.share_code = ? OR s.id = ?
    LIMIT 1
  `
  return db.prepare(sql).bind(code, code).first<JoinedShareNoteRow>()
}

/**
 * GET /api/share/:code
 * 外部公共访问笔记接口
 * - 无需 Candy Note 登录态
 * - 若有密码保护且未提供密码，返回需输入密码提示
 * - 若免密或密码正确，返回笔记完整内容
 */
publicShareRoutes.get('/:code', async (c) => {
  const code = c.req.param('code')
  const row = await queryShare(c.env.DB, code)

  if (!row) {
    return apiError(c, 404, 'SHARE_NOT_FOUND', '分享链接不存在或已被删除')
  }

  if (row.s_is_enabled !== 1) {
    return apiError(c, 404, 'SHARE_DISABLED', '该分享已被作者关闭')
  }

  const now = Date.now()
  if (row.s_expires_at !== null && row.s_expires_at < now) {
    return apiError(c, 410, 'SHARE_EXPIRED', '该分享链接已过期失效')
  }

  // 检查是否需要密码
  if (row.s_has_password === 1) {
    const pwd = c.req.query('password') || c.req.header('x-share-password')
    if (pwd) {
      const match = row.s_password_hash ? await verifyPassword(pwd, row.s_password_hash) : false
      if (!match) {
        return apiError(c, 401, 'SHARE_INVALID_PASSWORD', '访问密码错误，请重新输入')
      }
      // 密码验证成功，累加查看次数
      await c.env.DB.prepare(
        `UPDATE note_shares SET view_count = view_count + 1 WHERE id = ?`
      )
        .bind(row.s_id)
        .run()

      const noteDto: PublicNoteShareDto = {
        shareCode: row.s_share_code,
        title: row.n_title,
        content: row.n_content,
        format: row.n_format,
        authorName: row.author_name,
        expiresAt: row.s_expires_at,
        createdAt: row.s_created_at,
        updatedAt: row.n_updated_at,
        viewCount: row.s_view_count + 1
      }

      return c.json({
        ok: true,
        requirePassword: false,
        note: noteDto,
        share: noteDto
      })
    }

    // 未提供密码，提示需要输入密码
    const noteDto: PublicNoteShareDto = {
      shareCode: row.s_share_code,
      title: row.n_title,
      authorName: row.author_name,
      requirePassword: true,
      expiresAt: row.s_expires_at,
      createdAt: row.s_created_at,
      updatedAt: row.n_updated_at,
      viewCount: row.s_view_count
    }

    return c.json({
      ok: true,
      requirePassword: true,
      note: noteDto,
      share: noteDto
    })
  }

  // 免密公开分享，直接累加并返回
  await c.env.DB.prepare(
    `UPDATE note_shares SET view_count = view_count + 1 WHERE id = ?`
  )
    .bind(row.s_id)
    .run()

  const noteDto: PublicNoteShareDto = {
    shareCode: row.s_share_code,
    title: row.n_title,
    content: row.n_content,
    format: row.n_format,
    authorName: row.author_name,
    expiresAt: row.s_expires_at,
    createdAt: row.s_created_at,
    updatedAt: row.n_updated_at,
    viewCount: row.s_view_count + 1
  }

  return c.json({
    ok: true,
    requirePassword: false,
    note: noteDto,
    share: noteDto
  })
})

/**
 * POST /api/share/:code/access
 * 提交访问密码获取受保护笔记内容
 */
publicShareRoutes.post('/:code/access', async (c) => {
  const code = c.req.param('code')
  const body = await c.req.json<{ password?: string }>().catch(() => null)
  const password = body?.password ?? ''

  const row = await queryShare(c.env.DB, code)
  if (!row) {
    return apiError(c, 404, 'SHARE_NOT_FOUND', '分享链接不存在或已被删除')
  }

  if (row.s_is_enabled !== 1) {
    return apiError(c, 404, 'SHARE_DISABLED', '该分享已被作者关闭')
  }

  const now = Date.now()
  if (row.s_expires_at !== null && row.s_expires_at < now) {
    return apiError(c, 410, 'SHARE_EXPIRED', '该分享链接已过期失效')
  }

  if (row.s_has_password === 1) {
    if (!password) {
      return apiError(c, 400, 'SHARE_PASSWORD_REQUIRED', '请输入访问密码')
    }
    const match = row.s_password_hash ? await verifyPassword(password, row.s_password_hash) : false
    if (!match) {
      return apiError(c, 401, 'SHARE_INVALID_PASSWORD', '访问密码错误，请重新输入')
    }
  }

  await c.env.DB.prepare(
    `UPDATE note_shares SET view_count = view_count + 1 WHERE id = ?`
  )
    .bind(row.s_id)
    .run()

  const noteDto: PublicNoteShareDto = {
    shareCode: row.s_share_code,
    title: row.n_title,
    content: row.n_content,
    format: row.n_format,
    authorName: row.author_name,
    expiresAt: row.s_expires_at,
    createdAt: row.s_created_at,
    updatedAt: row.n_updated_at,
    viewCount: row.s_view_count + 1
  }

  return c.json({
    ok: true,
    requirePassword: false,
    note: noteDto,
    share: noteDto
  })
})
