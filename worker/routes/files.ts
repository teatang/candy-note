import { Hono } from 'hono'
import { requireAuth } from '../middleware/auth'
import type { AppEnv, AttachmentRow } from '../types'
import { apiError } from '../types'
import { generateId } from '../utils/crypto'
import {
  ALLOWED_IMAGE_MIME_EXT,
  MAX_IMAGE_SIZE_BYTES,
  sanitizeFilename
} from '../utils/validation'

/**
 * R2 对象存储图片附件路由模块
 * 处理笔记拖入/粘贴/选择上传的图片，将二进制存入 Cloudflare R2，并在 D1 中维护附件元数据
 */
export const fileRoutes = new Hono<AppEnv>()

fileRoutes.use('*', requireAuth)

/**
 * POST /api/files/upload
 * 上传图片至 Cloudflare R2 并返回安全访问地址
 */
fileRoutes.post('/upload', async (c) => {
  const user = c.get('user')
  const formData = await c.req.formData().catch(() => null)
  if (!formData) {
    return apiError(c, 400, 'VALIDATION_ERROR', '请使用 multipart/form-data 上传文件')
  }

  const fileEntry = formData.get('file')
  const noteIdRaw = formData.get('noteId')
  const noteId = typeof noteIdRaw === 'string' && noteIdRaw.trim() ? noteIdRaw.trim() : null

  if (!fileEntry || typeof fileEntry === 'string') {
    return apiError(c, 400, 'VALIDATION_ERROR', '未找到上传的图片文件')
  }

  const file = fileEntry as File
  const mimeType = (file.type || '').toLowerCase()
  const ext = ALLOWED_IMAGE_MIME_EXT[mimeType]
  if (!ext) {
    return apiError(
      c,
      400,
      'FILE_INVALID_TYPE',
      '仅支持 PNG、JPEG、GIF、WebP 格式图片'
    )
  }

  if (file.size <= 0 || file.size > MAX_IMAGE_SIZE_BYTES) {
    return apiError(
      c,
      400,
      'FILE_TOO_LARGE',
      '单张图片大小需大于 0 且不超过 5MB'
    )
  }

  if (noteId) {
    const ownedNote = await c.env.DB.prepare(
      `SELECT id FROM notes WHERE id = ? AND user_id = ? LIMIT 1`
    )
      .bind(noteId, user.id)
      .first<{ id: string }>()
    if (!ownedNote) {
      return apiError(c, 404, 'NOTE_NOT_FOUND', '关联笔记不存在')
    }
  }

  const now = Date.now()
  const dateObj = new Date(now)
  const ym = `${dateObj.getUTCFullYear()}-${String(dateObj.getUTCMonth() + 1).padStart(2, '0')}`
  const id = generateId()
  const filename = sanitizeFilename(file.name || `image.${ext}`)
  const r2Key = `users/${user.id}/${ym}/${id}.${ext}`

  const buffer = await file.arrayBuffer()
  await c.env.R2_BUCKET.put(r2Key, buffer, {
    httpMetadata: {
      contentType: mimeType
    },
    customMetadata: {
      userId: user.id,
      noteId: noteId || '',
      originalName: filename
    }
  })

  await c.env.DB.prepare(
    `INSERT INTO attachments (id, user_id, note_id, r2_key, filename, mime_type, size, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, user.id, noteId, r2Key, filename, mimeType, file.size, now)
    .run()

  return c.json(
    {
      ok: true,
      attachment: {
        id,
        noteId,
        filename,
        mimeType,
        size: file.size,
        url: `/api/files/${id}`,
        createdAt: now
      }
    },
    201
  )
})

/**
 * GET /api/files/note/:noteId
 * 查询指定笔记下关联的 R2 图片附件列表（注册在 /:id 之前避免路由冲突）
 */
fileRoutes.get('/note/:noteId', async (c) => {
  const user = c.get('user')
  const noteId = c.req.param('noteId')

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM attachments WHERE note_id = ? AND user_id = ? ORDER BY created_at DESC`
  )
    .bind(noteId, user.id)
    .all<AttachmentRow>()

  return c.json({
    ok: true,
    attachments: results.map((row) => ({
      id: row.id,
      noteId: row.note_id,
      filename: row.filename,
      mimeType: row.mime_type,
      size: row.size,
      url: `/api/files/${row.id}`,
      createdAt: row.created_at
    }))
  })
})

/**
 * GET /api/files/:id
 * 从 Cloudflare R2 读取并返回图片二进制流（仅允许所属用户或管理员访问）
 */
fileRoutes.get('/:id', async (c) => {
  const user = c.get('user')
  const fileId = c.req.param('id')

  const attachment = await c.env.DB.prepare(
    `SELECT * FROM attachments WHERE id = ? LIMIT 1`
  )
    .bind(fileId)
    .first<AttachmentRow>()

  if (!attachment) {
    return apiError(c, 404, 'FILE_NOT_FOUND', '图片附件不存在')
  }

  if (attachment.user_id !== user.id && user.role !== 'admin') {
    return apiError(c, 403, 'AUTH_FORBIDDEN', '无权访问该图片资源')
  }

  const r2Object = await c.env.R2_BUCKET.get(attachment.r2_key)
  if (!r2Object) {
    return apiError(c, 404, 'FILE_NOT_FOUND', 'R2 对象存储中未找到该图片')
  }

  const headers = new Headers()
  headers.set('Content-Type', attachment.mime_type)
  headers.set('Content-Length', String(attachment.size))
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Cache-Control', 'private, max-age=86400')

  return new Response(r2Object.body, { status: 200, headers })
})

/**
 * DELETE /api/files/:id
 * 从 Cloudflare R2 和 D1 中删除指定图片附件
 */
fileRoutes.delete('/:id', async (c) => {
  const user = c.get('user')
  const fileId = c.req.param('id')

  const attachment = await c.env.DB.prepare(
    `SELECT * FROM attachments WHERE id = ? AND user_id = ? LIMIT 1`
  )
    .bind(fileId, user.id)
    .first<AttachmentRow>()

  if (!attachment) {
    return apiError(c, 404, 'FILE_NOT_FOUND', '图片附件不存在')
  }

  await c.env.R2_BUCKET.delete(attachment.r2_key)
  await c.env.DB.prepare(`DELETE FROM attachments WHERE id = ? AND user_id = ?`)
    .bind(fileId, user.id)
    .run()

  return c.json({ ok: true })
})
