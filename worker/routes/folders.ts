import { Hono } from 'hono'
import { toFolderDto } from '../db/repository'
import { requireAuth } from '../middleware/auth'
import type { AppEnv, FolderRow } from '../types'
import { apiError } from '../types'
import { generateId } from '../utils/crypto'

/**
 * 文件夹管理路由模块
 * 支持文件夹的增删改查、多级父子关系校验及任意拖动排序
 */
export const folderRoutes = new Hono<AppEnv>()

folderRoutes.use('*', requireAuth)

/**
 * 检查将 folderId 移动到 targetParentId 下是否会产生循环引用
 */
function createsCycle(
  folders: FolderRow[],
  folderId: string,
  targetParentId: string | null
): boolean {
  if (!targetParentId) return false
  if (targetParentId === folderId) return true
  const parentMap = new Map<string, string | null>()
  for (const f of folders) {
    parentMap.set(f.id, f.parent_id)
  }
  let cursor: string | null | undefined = targetParentId
  const visited = new Set<string>()
  while (cursor) {
    if (cursor === folderId) return true
    if (visited.has(cursor)) return true
    visited.add(cursor)
    cursor = parentMap.get(cursor)
  }
  return false
}

/**
 * GET /api/folders
 * 获取当前用户的全部文件夹列表（按自定义拖动排序序升序排列）
 */
folderRoutes.get('/', async (c) => {
  const user = c.get('user')
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM folders WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC`
  )
    .bind(user.id)
    .all<FolderRow>()

  return c.json({
    ok: true,
    folders: results.map(toFolderDto)
  })
})

/**
 * POST /api/folders
 * 新建文件夹，默认追加在同级末尾
 */
folderRoutes.post('/', async (c) => {
  const user = c.get('user')
  const body = await c.req
    .json<{ name?: string; parentId?: string | null }>()
    .catch(() => null)

  const name = (body?.name || '').trim()
  const parentId = body?.parentId || null

  if (!name || name.length > 60) {
    return apiError(c, 400, 'VALIDATION_ERROR', '文件夹名称长度需在 1 至 60 个字符之间')
  }

  if (parentId) {
    const parent = await c.env.DB.prepare(
      `SELECT id FROM folders WHERE id = ? AND user_id = ? LIMIT 1`
    )
      .bind(parentId, user.id)
      .first<{ id: string }>()
    if (!parent) {
      return apiError(c, 404, 'FOLDER_NOT_FOUND', '指定的父文件夹不存在')
    }
  }

  const maxRow = await c.env.DB.prepare(
    `SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM folders WHERE user_id = ?`
  )
    .bind(user.id)
    .first<{ max_order: number }>()

  const id = generateId()
  const now = Date.now()
  const sortOrder = (maxRow?.max_order ?? -1) + 1

  await c.env.DB.prepare(
    `INSERT INTO folders (id, user_id, parent_id, name, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, user.id, parentId, name, sortOrder, now, now)
    .run()

  return c.json(
    {
      ok: true,
      folder: {
        id,
        userId: user.id,
        parentId,
        name,
        sortOrder,
        createdAt: now,
        updatedAt: now
      }
    },
    201
  )
})

/**
 * PATCH /api/folders/reorder
 * 批量更新文件夹拖动排序序号与层级关系（需注册在 /:id 之前避免路由冲突）
 */
folderRoutes.patch('/reorder', async (c) => {
  const user = c.get('user')
  const body = await c.req
    .json<{
      items?: Array<{ id: string; sortOrder: number; parentId?: string | null }>
    }>()
    .catch(() => null)

  const items = body?.items
  if (!Array.isArray(items) || items.length === 0) {
    return apiError(c, 400, 'VALIDATION_ERROR', '请提供有效的排序列表')
  }

  const { results: userFolders } = await c.env.DB.prepare(
    `SELECT * FROM folders WHERE user_id = ?`
  )
    .bind(user.id)
    .all<FolderRow>()

  const ownedMap = new Map(userFolders.map((f) => [f.id, f]))
  // 模拟合并后的父级状态以校验是否存在循环引用
  const simulated = userFolders.map((f) => ({ ...f }))
  for (const item of items) {
    if (!ownedMap.has(item.id)) {
      return apiError(c, 404, 'FOLDER_NOT_FOUND', '包含不存在或无权限的文件夹')
    }
    if (item.parentId !== undefined) {
      if (item.parentId !== null && !ownedMap.has(item.parentId)) {
        return apiError(c, 404, 'FOLDER_NOT_FOUND', '目标父文件夹不存在')
      }
      const target = simulated.find((s) => s.id === item.id)!
      target.parent_id = item.parentId
    }
  }

  for (const item of items) {
    const current = simulated.find((s) => s.id === item.id)!
    if (createsCycle(simulated, item.id, current.parent_id)) {
      return apiError(c, 400, 'FOLDER_CYCLE_ERROR', '不能将文件夹移动到自身或其子文件夹下')
    }
  }

  const now = Date.now()
  const statements = items.map((item) => {
    const existing = ownedMap.get(item.id)!
    const nextParentId = item.parentId === undefined ? existing.parent_id : item.parentId
    return c.env.DB.prepare(
      `UPDATE folders SET sort_order = ?, parent_id = ?, updated_at = ? WHERE id = ? AND user_id = ?`
    ).bind(Number(item.sortOrder), nextParentId, now, item.id, user.id)
  })

  await c.env.DB.batch(statements)
  return c.json({ ok: true })
})

/**
 * PATCH /api/folders/:id
 * 重命名文件夹或修改父文件夹
 */
folderRoutes.patch('/:id', async (c) => {
  const user = c.get('user')
  const folderId = c.req.param('id')
  const body = await c.req
    .json<{ name?: string; parentId?: string | null }>()
    .catch(() => null)

  if (!body) {
    return apiError(c, 400, 'VALIDATION_ERROR', '请求体不能为空')
  }

  const { results: userFolders } = await c.env.DB.prepare(
    `SELECT * FROM folders WHERE user_id = ?`
  )
    .bind(user.id)
    .all<FolderRow>()

  const existing = userFolders.find((f) => f.id === folderId)
  if (!existing) {
    return apiError(c, 404, 'FOLDER_NOT_FOUND', '文件夹不存在')
  }

  const nextName = body.name !== undefined ? body.name.trim() : existing.name
  if (!nextName || nextName.length > 60) {
    return apiError(c, 400, 'VALIDATION_ERROR', '文件夹名称长度需在 1 至 60 个字符之间')
  }

  const nextParentId = body.parentId !== undefined ? body.parentId : existing.parent_id
  if (nextParentId !== null) {
    const parentExists = userFolders.some((f) => f.id === nextParentId)
    if (!parentExists) {
      return apiError(c, 404, 'FOLDER_NOT_FOUND', '父文件夹不存在')
    }
    if (createsCycle(userFolders, folderId, nextParentId)) {
      return apiError(c, 400, 'FOLDER_CYCLE_ERROR', '不能将文件夹移动到自身或其子文件夹下')
    }
  }

  const now = Date.now()
  await c.env.DB.prepare(
    `UPDATE folders SET name = ?, parent_id = ?, updated_at = ? WHERE id = ? AND user_id = ?`
  )
    .bind(nextName, nextParentId, now, folderId, user.id)
    .run()

  return c.json({
    ok: true,
    folder: toFolderDto({
      ...existing,
      name: nextName,
      parent_id: nextParentId,
      updated_at: now
    })
  })
})

/**
 * DELETE /api/folders/:id
 * 删除文件夹：安全地将其及子文件夹内的笔记移入“未分类”，防止用户笔记意外丢失
 */
folderRoutes.delete('/:id', async (c) => {
  const user = c.get('user')
  const folderId = c.req.param('id')

  const { results: userFolders } = await c.env.DB.prepare(
    `SELECT * FROM folders WHERE user_id = ?`
  )
    .bind(user.id)
    .all<FolderRow>()

  if (!userFolders.some((f) => f.id === folderId)) {
    return apiError(c, 404, 'FOLDER_NOT_FOUND', '文件夹不存在')
  }

  // 递归收集当前文件夹及所有子文件夹 ID
  const idsToDelete = new Set<string>([folderId])
  let added = true
  while (added) {
    added = false
    for (const f of userFolders) {
      if (f.parent_id && idsToDelete.has(f.parent_id) && !idsToDelete.has(f.id)) {
        idsToDelete.add(f.id)
        added = true
      }
    }
  }

  const now = Date.now()
  const statements: D1PreparedStatement[] = []
  for (const id of idsToDelete) {
    statements.push(
      c.env.DB.prepare(
        `UPDATE notes SET folder_id = NULL, updated_at = ? WHERE folder_id = ? AND user_id = ?`
      ).bind(now, id, user.id)
    )
  }
  statements.push(
    c.env.DB.prepare(`DELETE FROM folders WHERE id = ? AND user_id = ?`).bind(folderId, user.id)
  )

  await c.env.DB.batch(statements)
  return c.json({ ok: true, deletedIds: Array.from(idsToDelete) })
})
