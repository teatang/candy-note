import type { Context } from 'hono'

/**
 * Cloudflare Worker 环境变量与资源绑定类型定义
 */
export interface Env {
  /** Cloudflare D1 关系型数据库绑定 */
  DB: D1Database
  /** Cloudflare R2 对象存储桶绑定（用于存储笔记图片） */
  R2_BUCKET: R2Bucket
  /** Cloudflare Workers 静态资源绑定 */
  ASSETS?: Fetcher
  /** 默认初始化管理员用户名（可选） */
  DEFAULT_ADMIN_USERNAME?: string
  /** 默认初始化管理员邮箱（可选） */
  DEFAULT_ADMIN_EMAIL?: string
  /** 默认初始化管理员密码（建议生产环境通过 wrangler secret 设置） */
  DEFAULT_ADMIN_PASSWORD?: string
}

/** 用户角色类型 */
export type UserRole = 'admin' | 'user'

/** 用户账号状态类型 */
export type UserStatus = 'active' | 'disabled'

/** 笔记格式类型：plain 普通文本 / markdown */
export type NoteFormat = 'plain' | 'markdown'

/** 历史版本变更类型 */
export type VersionChangeType = 'create' | 'save' | 'auto_save' | 'before_rollback'

/** 数据库用户表原始行结构 */
export interface UserRow {
  id: string
  username: string
  email: string
  password_hash: string
  role: UserRole
  status: UserStatus
  must_change_password: number
  created_at: number
  updated_at: number
  last_login_at: number | null
}

/** 返回给前端的安全用户信息（剔除密码哈希） */
export interface SafeUser {
  id: string
  username: string
  email: string
  role: UserRole
  status: UserStatus
  mustChangePassword: boolean
  createdAt: number
  updatedAt: number
  lastLoginAt: number | null
}

/** 数据库会话表原始行结构 */
export interface SessionRow {
  id: string
  user_id: string
  token_hash: string
  remember_me: number
  user_agent: string | null
  created_at: number
  expires_at: number
  last_active_at: number
}

/** 数据库文件夹表原始行结构 */
export interface FolderRow {
  id: string
  user_id: string
  parent_id: string | null
  name: string
  sort_order: number
  created_at: number
  updated_at: number
}

/** 数据库笔记表原始行结构 */
export interface NoteRow {
  id: string
  user_id: string
  folder_id: string | null
  title: string
  content: string
  format: NoteFormat
  is_pinned: number
  pinned_at: number | null
  sort_order: number
  created_at: number
  updated_at: number
}

/** 数据库笔记历史版本原始行结构 */
export interface NoteVersionRow {
  id: string
  note_id: string
  user_id: string
  title: string
  content: string
  format: NoteFormat
  folder_id: string | null
  version_number: number
  change_type: VersionChangeType
  created_at: number
}

/** 数据库 R2 附件元数据原始行结构 */
export interface AttachmentRow {
  id: string
  user_id: string
  note_id: string | null
  r2_key: string
  filename: string
  mime_type: string
  size: number
  created_at: number
}

/** Hono 应用上下文类型绑定 */
export interface AppEnv {
  Bindings: Env
  Variables: {
    user: SafeUser
    session: SessionRow
  }
}

export type AppContext = Context<AppEnv>

/** 统一业务错误码，便于前端多语言文案映射 */
export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'AUTH_INVALID_CAPTCHA'
  | 'AUTH_CAPTCHA_EXPIRED'
  | 'AUTH_INVALID_CREDENTIALS'
  | 'AUTH_USER_DISABLED'
  | 'AUTH_UNAUTHORIZED'
  | 'AUTH_FORBIDDEN'
  | 'AUTH_REGISTRATION_DISABLED'
  | 'USER_CONFLICT'
  | 'USER_NOT_FOUND'
  | 'CANNOT_MODIFY_SELF'
  | 'CANNOT_DELETE_LAST_ADMIN'
  | 'FOLDER_NOT_FOUND'
  | 'FOLDER_CYCLE_ERROR'
  | 'NOTE_NOT_FOUND'
  | 'VERSION_NOT_FOUND'
  | 'VERSION_EXPIRED'
  | 'FILE_INVALID_TYPE'
  | 'FILE_TOO_LARGE'
  | 'FILE_NOT_FOUND'
  | 'INTERNAL_ERROR'

/**
 * 构造统一错误 JSON 响应
 */
export function apiError(
  c: Context,
  status: number,
  code: ApiErrorCode,
  message: string
): Response {
  return c.json({ ok: false, code, message }, status as 400)
}
