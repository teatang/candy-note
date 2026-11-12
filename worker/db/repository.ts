import type {
  Env,
  FolderRow,
  NoteFormat,
  NoteRow,
  NoteVersionRow,
  SafeUser,
  UserRole,
  UserRow,
  UserStatus
} from '../types'
import { generateId, hashPassword } from '../utils/crypto'
import { SEVEN_DAYS_MS } from '../utils/validation'

/**
 * 将数据库用户行转换为可安全返回给前端的 DTO（移除敏感哈希字段）
 */
export function toSafeUser(row: UserRow): SafeUser {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    role: row.role,
    status: row.status,
    mustChangePassword: row.must_change_password === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at
  }
}

/**
 * 将数据库文件夹行转换为前端 camelCase 对象
 */
export function toFolderDto(row: FolderRow) {
  return {
    id: row.id,
    userId: row.user_id,
    parentId: row.parent_id,
    name: row.name,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/**
 * 将数据库笔记行转换为前端 camelCase 对象
 */
export function toNoteDto(row: NoteRow) {
  return {
    id: row.id,
    userId: row.user_id,
    folderId: row.folder_id,
    title: row.title,
    content: row.content,
    format: row.format,
    isPinned: row.is_pinned === 1,
    pinnedAt: row.pinned_at,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/**
 * 将数据库笔记版本行转换为前端 camelCase 对象
 */
export function toNoteVersionDto(row: NoteVersionRow) {
  return {
    id: row.id,
    noteId: row.note_id,
    userId: row.user_id,
    title: row.title,
    content: row.content,
    format: row.format,
    folderId: row.folder_id,
    versionNumber: row.version_number,
    changeType: row.change_type,
    createdAt: row.created_at
  }
}

/**
 * 确保系统中至少存在一个初始化管理员账号
 * 仅在首次启动或无管理员存在时自动创建默认管理员（不开放前台注册）
 */
export async function ensureInitialAdmin(db: D1Database, env: Env): Promise<void> {
  const existingAdmin = await db
    .prepare(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`)
    .first<{ id: string }>()

  if (existingAdmin) return

  const now = Date.now()
  const username = (env.DEFAULT_ADMIN_USERNAME || 'admin').trim()
  const email = (env.DEFAULT_ADMIN_EMAIL || 'admin@candynote.local').trim().toLowerCase()
  const customPassword = env.DEFAULT_ADMIN_PASSWORD?.trim()
  const initialPassword = customPassword || 'CandyAdmin123!'
  const passwordHash = await hashPassword(initialPassword)

  // 使用 INSERT OR IGNORE 防止并发冷启动重复插入冲突
  await db
    .prepare(
      `INSERT OR IGNORE INTO users (id, username, email, password_hash, role, status, must_change_password, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'admin', 'active', ?, ?, ?)`
    )
    .bind(
      generateId(),
      username,
      email,
      passwordHash,
      customPassword ? 0 : 1,
      now,
      now
    )
    .run()
}

/**
 * 清理过期验证码、过期会话及超过 7 天的笔记历史版本
 * 可由定时任务触发，也可在关键 API 请求时按需惰性清理
 */
export async function cleanupExpiredData(db: D1Database, now = Date.now()): Promise<void> {
  const sevenDaysAgo = now - SEVEN_DAYS_MS
  await db.batch([
    db.prepare(`DELETE FROM captchas WHERE expires_at < ?`).bind(now),
    db.prepare(`DELETE FROM sessions WHERE expires_at < ?`).bind(now),
    db.prepare(`DELETE FROM note_versions WHERE created_at < ?`).bind(sevenDaysAgo)
  ])
}

/**
 * 根据用户 ID 创建笔记历史快照，并自动清理该笔记超过 7 天的过期版本
 */
export async function createNoteVersionSnapshot(
  db: D1Database,
  params: {
    noteId: string
    userId: string
    title: string
    content: string
    format: NoteFormat
    folderId: string | null
    changeType: 'create' | 'save' | 'auto_save' | 'before_rollback'
    now?: number
  }
): Promise<NoteVersionRow> {
  const now = params.now ?? Date.now()
  const sevenDaysAgo = now - SEVEN_DAYS_MS

  // 先清理该笔记 7 天前的过期历史版本
  await db
    .prepare(`DELETE FROM note_versions WHERE note_id = ? AND created_at < ?`)
    .bind(params.noteId, sevenDaysAgo)
    .run()

  // 查询当前最高版本号
  const maxRow = await db
    .prepare(`SELECT COALESCE(MAX(version_number), 0) AS max_ver FROM note_versions WHERE note_id = ?`)
    .bind(params.noteId)
    .first<{ max_ver: number }>()

  const nextVersion = (maxRow?.max_ver ?? 0) + 1
  const id = generateId()

  await db
    .prepare(
      `INSERT INTO note_versions (id, note_id, user_id, title, content, format, folder_id, version_number, change_type, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      params.noteId,
      params.userId,
      params.title,
      params.content,
      params.format,
      params.folderId,
      nextVersion,
      params.changeType,
      now
    )
    .run()

  return {
    id,
    note_id: params.noteId,
    user_id: params.userId,
    title: params.title,
    content: params.content,
    format: params.format,
    folder_id: params.folderId,
    version_number: nextVersion,
    change_type: params.changeType,
    created_at: now
  }
}

/**
 * 查询管理员创建/编辑用户参数校验后的安全写入接口类型
 */
export interface CreateUserInput {
  username: string
  email: string
  password: string
  role: UserRole
  status: UserStatus
}
