import { Hono } from 'hono'
import {
  createNoteVersionSnapshot,
  toNoteDto,
  toNoteVersionDto
} from '../db/repository'
import { requireAuth } from '../middleware/auth'
import type { AppEnv, AttachmentRow, NoteFormat, NoteRow, NoteVersionRow } from '../types'
import { apiError } from '../types'
import { generateId } from '../utils/crypto'
import { SEVEN_DAYS_MS } from '../utils/validation'

/** 自动保存触发历史快照的最小间隔：30 秒（防止高频输入产生大量冗余版本） */
const AUTO_VERSION_INTERVAL_MS = 30 * 1000

/**
 * 笔记管理与历史版本路由模块
 * - 支持普通文本 (plain) 与 Markdown (markdown) 两种格式
 * - 支持按文件夹筛选、关键词检索、置顶/取消置顶
 * - 支持任意拖动排序及跨文件夹拖放移动
 * - 支持 7 天（一周）内历史版本查看与一键回退
 */
export const noteRoutes = new Hono<AppEnv>()

noteRoutes.use('*', requireAuth)

/**
 * GET /api/notes
 * 获取当前用户笔记列表（置顶笔记优先，其次按拖动排序序号升序、更新时间降序）
 */
noteRoutes.get('/', async (c) => {
  const user = c.get('user')
  const folderId = c.req.query('folderId')
  const query = (c.req.query('q') || '').trim().toLowerCase()
  const format = c.req.query('format')

  const conditions: string[] = ['user_id = ?']
  const bindings: unknown[] = [user.id]

  if (folderId === 'uncategorized') {
    conditions.push('folder_id IS NULL')
  } else if (folderId && folderId !== 'all') {
    conditions.push('folder_id = ?')
    bindings.push(folderId)
  }

  if (format === 'plain' || format === 'markdown') {
    conditions.push('format = ?')
    bindings.push(format)
  }

  if (query) {
    conditions.push('(LOWER(title) LIKE ? OR LOWER(content) LIKE ?)')
    const likeTerm = `%${query}%`
    bindings.push(likeTerm, likeTerm)
  }

  const sql = `
    SELECT * FROM notes
    WHERE ${conditions.join(' AND ')}
    ORDER BY is_pinned DESC, sort_order ASC, updated_at DESC
  `
  const { results } = await c.env.DB.prepare(sql)
    .bind(...bindings)
    .all<NoteRow>()

  return c.json({
    ok: true,
    notes: results.map(toNoteDto)
  })
})

/**
 * POST /api/notes
 * 创建新笔记并自动写入第 1 个历史版本快照
 */
noteRoutes.post('/', async (c) => {
  const user = c.get('user')
  const body = await c.req
    .json<{
      title?: string
      content?: string
      format?: NoteFormat
      folderId?: string | null
      isPinned?: boolean
    }>()
    .catch(() => null)

  const title = (body?.title ?? '').slice(0, 200)
  const content = body?.content ?? ''
  const format: NoteFormat = body?.format === 'plain' ? 'plain' : 'markdown'
  const folderId = body?.folderId || null
  const isPinned = Boolean(body?.isPinned)

  if (folderId) {
    const folder = await c.env.DB.prepare(
      `SELECT id FROM folders WHERE id = ? AND user_id = ? LIMIT 1`
    )
      .bind(folderId, user.id)
      .first<{ id: string }>()
    if (!folder) {
      return apiError(c, 404, 'FOLDER_NOT_FOUND', '目标文件夹不存在')
    }
  }

  // 新建笔记默认置于列表顶部（min sort_order - 1）
  const minRow = await c.env.DB.prepare(
    `SELECT COALESCE(MIN(sort_order), 1) AS min_order FROM notes WHERE user_id = ?`
  )
    .bind(user.id)
    .first<{ min_order: number }>()

  const id = generateId()
  const now = Date.now()
  const sortOrder = (minRow?.min_order ?? 1) - 1
  const pinnedAt = isPinned ? now : null

  await c.env.DB.prepare(
    `INSERT INTO notes (id, user_id, folder_id, title, content, format, is_pinned, pinned_at, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, user.id, folderId, title, content, format, isPinned ? 1 : 0, pinnedAt, sortOrder, now, now)
    .run()

  await createNoteVersionSnapshot(c.env.DB, {
    noteId: id,
    userId: user.id,
    title,
    content,
    format,
    folderId,
    changeType: 'create',
    now
  })

  return c.json(
    {
      ok: true,
      note: {
        id,
        userId: user.id,
        folderId,
        title,
        content,
        format,
        isPinned,
        pinnedAt,
        sortOrder,
        createdAt: now,
        updatedAt: now
      }
    },
    201
  )
})

/**
 * PATCH /api/notes/reorder
 * 批量保存笔记拖动排序结果，支持同时修改目标文件夹或置顶状态
 */
noteRoutes.patch('/reorder', async (c) => {
  const user = c.get('user')
  const body = await c.req
    .json<{
      items?: Array<{
        id: string
        sortOrder: number
        folderId?: string | null
        isPinned?: boolean
      }>
    }>()
    .catch(() => null)

  const items = body?.items
  if (!Array.isArray(items) || items.length === 0) {
    return apiError(c, 400, 'VALIDATION_ERROR', '请提供有效的笔记排序列表')
  }

  const now = Date.now()
  const statements: D1PreparedStatement[] = []

  for (const item of items) {
    const existing = await c.env.DB.prepare(
      `SELECT * FROM notes WHERE id = ? AND user_id = ? LIMIT 1`
    )
      .bind(item.id, user.id)
      .first<NoteRow>()

    if (!existing) {
      return apiError(c, 404, 'NOTE_NOT_FOUND', '包含不存在或无权限的笔记')
    }

    let nextFolderId = existing.folder_id
    if (item.folderId !== undefined) {
      if (item.folderId !== null) {
        const folder = await c.env.DB.prepare(
          `SELECT id FROM folders WHERE id = ? AND user_id = ? LIMIT 1`
        )
          .bind(item.folderId, user.id)
          .first<{ id: string }>()
        if (!folder) {
          return apiError(c, 404, 'FOLDER_NOT_FOUND', '目标文件夹不存在')
        }
      }
      nextFolderId = item.folderId
    }

    const nextPinned = item.isPinned !== undefined ? (item.isPinned ? 1 : 0) : existing.is_pinned
    const nextPinnedAt =
      item.isPinned !== undefined
        ? item.isPinned
          ? existing.pinned_at ?? now
          : null
        : existing.pinned_at

    statements.push(
      c.env.DB.prepare(
        `UPDATE notes SET sort_order = ?, folder_id = ?, is_pinned = ?, pinned_at = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`
      ).bind(Number(item.sortOrder), nextFolderId, nextPinned, nextPinnedAt, now, item.id, user.id)
    )
  }

  await c.env.DB.batch(statements)
  return c.json({ ok: true })
})

/**
 * GET /api/notes/:id
 * 获取单篇笔记详情
 */
noteRoutes.get('/:id', async (c) => {
  const user = c.get('user')
  const noteId = c.req.param('id')

  const note = await c.env.DB.prepare(
    `SELECT * FROM notes WHERE id = ? AND user_id = ? LIMIT 1`
  )
    .bind(noteId, user.id)
    .first<NoteRow>()

  if (!note) {
    return apiError(c, 404, 'NOTE_NOT_FOUND', '笔记不存在')
  }

  return c.json({ ok: true, note: toNoteDto(note) })
})

/**
 * PATCH /api/notes/:id
 * 更新笔记内容、标题、格式、所属文件夹或置顶状态，并按策略生成 7 天内可回退的历史版本
 */
noteRoutes.patch('/:id', async (c) => {
  const user = c.get('user')
  const noteId = c.req.param('id')
  const body = await c.req
    .json<{
      title?: string
      content?: string
      format?: NoteFormat
      folderId?: string | null
      isPinned?: boolean
      changeType?: 'save' | 'auto_save'
      createVersion?: boolean
    }>()
    .catch(() => null)

  if (!body) {
    return apiError(c, 400, 'VALIDATION_ERROR', '请求体不能为空')
  }

  const existing = await c.env.DB.prepare(
    `SELECT * FROM notes WHERE id = ? AND user_id = ? LIMIT 1`
  )
    .bind(noteId, user.id)
    .first<NoteRow>()

  if (!existing) {
    return apiError(c, 404, 'NOTE_NOT_FOUND', '笔记不存在')
  }

  const nextTitle = body.title !== undefined ? body.title.slice(0, 200) : existing.title
  const nextContent = body.content !== undefined ? body.content : existing.content
  const nextFormat: NoteFormat =
    body.format === 'plain' || body.format === 'markdown' ? body.format : existing.format

  let nextFolderId = existing.folder_id
  if (body.folderId !== undefined) {
    if (body.folderId !== null) {
      const folder = await c.env.DB.prepare(
        `SELECT id FROM folders WHERE id = ? AND user_id = ? LIMIT 1`
      )
        .bind(body.folderId, user.id)
        .first<{ id: string }>()
      if (!folder) {
        return apiError(c, 404, 'FOLDER_NOT_FOUND', '目标文件夹不存在')
      }
    }
    nextFolderId = body.folderId
  }

  const nextPinned = body.isPinned !== undefined ? (body.isPinned ? 1 : 0) : existing.is_pinned
  const nextPinnedAt =
    body.isPinned !== undefined
      ? body.isPinned
        ? existing.pinned_at ?? Date.now()
        : null
      : existing.pinned_at

  const now = Date.now()
  await c.env.DB.prepare(
    `UPDATE notes
     SET title = ?, content = ?, format = ?, folder_id = ?, is_pinned = ?, pinned_at = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`
  )
    .bind(
      nextTitle,
      nextContent,
      nextFormat,
      nextFolderId,
      nextPinned,
      nextPinnedAt,
      now,
      noteId,
      user.id
    )
    .run()

  // 检测内容、标题或格式是否发生实质变化，按手动保存或节流自动保存创建历史快照
  const contentChanged =
    nextTitle !== existing.title ||
    nextContent !== existing.content ||
    nextFormat !== existing.format

  if (contentChanged || body.createVersion) {
    const latestVersion = await c.env.DB.prepare(
      `SELECT title, content, format, created_at FROM note_versions
       WHERE note_id = ? ORDER BY version_number DESC LIMIT 1`
    )
      .bind(noteId)
      .first<Pick<NoteVersionRow, 'title' | 'content' | 'format' | 'created_at'>>()

    const differsFromLatest =
      !latestVersion ||
      latestVersion.title !== nextTitle ||
      latestVersion.content !== nextContent ||
      latestVersion.format !== nextFormat

    const isManualSave = body.changeType === 'save' || body.createVersion === true
    const intervalElapsed =
      !latestVersion || now - latestVersion.created_at >= AUTO_VERSION_INTERVAL_MS

    if (differsFromLatest && (isManualSave || intervalElapsed)) {
      await createNoteVersionSnapshot(c.env.DB, {
        noteId,
        userId: user.id,
        title: nextTitle,
        content: nextContent,
        format: nextFormat,
        folderId: nextFolderId,
        changeType: isManualSave ? 'save' : 'auto_save',
        now
      })
    }
  }

  const updated: NoteRow = {
    ...existing,
    title: nextTitle,
    content: nextContent,
    format: nextFormat,
    folder_id: nextFolderId,
    is_pinned: nextPinned,
    pinned_at: nextPinnedAt,
    updated_at: now
  }

  return c.json({ ok: true, note: toNoteDto(updated) })
})

/**
 * DELETE /api/notes/:id
 * 删除笔记，并同步清理关联的历史版本与 R2 图片附件
 */
noteRoutes.delete('/:id', async (c) => {
  const user = c.get('user')
  const noteId = c.req.param('id')

  const existing = await c.env.DB.prepare(
    `SELECT id FROM notes WHERE id = ? AND user_id = ? LIMIT 1`
  )
    .bind(noteId, user.id)
    .first<{ id: string }>()

  if (!existing) {
    return apiError(c, 404, 'NOTE_NOT_FOUND', '笔记不存在')
  }

  // 查询关联附件以便同步清理 R2 对象存储
  const { results: attachments } = await c.env.DB.prepare(
    `SELECT id, r2_key FROM attachments WHERE note_id = ? AND user_id = ?`
  )
    .bind(noteId, user.id)
    .all<Pick<AttachmentRow, 'id' | 'r2_key'>>()

  for (const att of attachments) {
    await c.env.R2_BUCKET.delete(att.r2_key)
  }

  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM attachments WHERE note_id = ? AND user_id = ?`).bind(
      noteId,
      user.id
    ),
    c.env.DB.prepare(`DELETE FROM notes WHERE id = ? AND user_id = ?`).bind(noteId, user.id)
  ])

  return c.json({ ok: true })
})

/**
 * GET /api/notes/:id/versions
 * 查询笔记最近一周（7 天）内的历史版本记录，同时自动清除超过 7 天的过期快照
 */
noteRoutes.get('/:id/versions', async (c) => {
  const user = c.get('user')
  const noteId = c.req.param('id')

  const note = await c.env.DB.prepare(
    `SELECT id FROM notes WHERE id = ? AND user_id = ? LIMIT 1`
  )
    .bind(noteId, user.id)
    .first<{ id: string }>()

  if (!note) {
    return apiError(c, 404, 'NOTE_NOT_FOUND', '笔记不存在')
  }

  const cutoff = Date.now() - SEVEN_DAYS_MS
  // 清理超过 7 天的旧版本
  await c.env.DB.prepare(`DELETE FROM note_versions WHERE note_id = ? AND created_at < ?`)
    .bind(noteId, cutoff)
    .run()

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM note_versions
     WHERE note_id = ? AND user_id = ? AND created_at >= ?
     ORDER BY version_number DESC`
  )
    .bind(noteId, user.id, cutoff)
    .all<NoteVersionRow>()

  return c.json({
    ok: true,
    versions: results.map(toNoteVersionDto)
  })
})

/**
 * POST /api/notes/:id/versions/:versionId/rollback
 * 将笔记回退到一周（7 天）内的指定历史版本
 * 回退前自动为当前正文创建一份 before_rollback 安全快照，避免误操作不可逆
 */
noteRoutes.post('/:id/versions/:versionId/rollback', async (c) => {
  const user = c.get('user')
  const noteId = c.req.param('id')
  const versionId = c.req.param('versionId')

  const note = await c.env.DB.prepare(
    `SELECT * FROM notes WHERE id = ? AND user_id = ? LIMIT 1`
  )
    .bind(noteId, user.id)
    .first<NoteRow>()

  if (!note) {
    return apiError(c, 404, 'NOTE_NOT_FOUND', '笔记不存在')
  }

  const version = await c.env.DB.prepare(
    `SELECT * FROM note_versions WHERE id = ? AND note_id = ? AND user_id = ? LIMIT 1`
  )
    .bind(versionId, noteId, user.id)
    .first<NoteVersionRow>()

  if (!version) {
    return apiError(c, 404, 'VERSION_NOT_FOUND', '目标历史版本不存在')
  }

  const now = Date.now()
  if (now - version.created_at > SEVEN_DAYS_MS) {
    await c.env.DB.prepare(`DELETE FROM note_versions WHERE id = ?`).bind(version.id).run()
    return apiError(c, 400, 'VERSION_EXPIRED', '该历史版本已超过 7 天保留期限，无法回退')
  }

  // 回退前先保存当前状态为保护快照
  await createNoteVersionSnapshot(c.env.DB, {
    noteId: note.id,
    userId: user.id,
    title: note.title,
    content: note.content,
    format: note.format,
    folderId: note.folder_id,
    changeType: 'before_rollback',
    now
  })

  await c.env.DB.prepare(
    `UPDATE notes SET title = ?, content = ?, format = ?, updated_at = ? WHERE id = ? AND user_id = ?`
  )
    .bind(version.title, version.content, version.format, now, note.id, user.id)
    .run()

  const restoredNote: NoteRow = {
    ...note,
    title: version.title,
    content: version.content,
    format: version.format,
    updated_at: now
  }

  return c.json({
    ok: true,
    note: toNoteDto(restoredNote),
    restoredFromVersionId: version.id
  })
})
