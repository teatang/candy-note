/**
 * 前端通用 TypeScript 类型定义模块
 */

export type ThemeMode = 'light' | 'dark' | 'system'
export type LocaleCode = 'zh-CN' | 'en-US'
export type UserRole = 'admin' | 'user'
export type UserStatus = 'active' | 'disabled'
export type NoteFormat = 'plain' | 'markdown'
export type MarkdownViewMode = 'split' | 'edit' | 'preview'
export type VersionChangeType = 'create' | 'save' | 'auto_save' | 'before_rollback'

/** 安全用户信息 */
export interface User {
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

/** 会话信息 */
export interface SessionInfo {
  id: string
  rememberMe: boolean
  expiresAt: number
}

/** 验证码响应数据结构 */
export interface CaptchaPayload {
  captchaId: string
  image: string
  expiresAt: number
}

/** 文件夹模型 */
export interface Folder {
  id: string
  userId: string
  parentId: string | null
  name: string
  sortOrder: number
  createdAt: number
  updatedAt: number
}

/** 笔记模型 */
export interface Note {
  id: string
  userId: string
  folderId: string | null
  title: string
  content: string
  format: NoteFormat
  isPinned: boolean
  pinnedAt: number | null
  sortOrder: number
  createdAt: number
  updatedAt: number
}

/** 笔记历史版本模型（一周内） */
export interface NoteVersion {
  id: string
  noteId: string
  userId: string
  title: string
  content: string
  format: NoteFormat
  folderId: string | null
  versionNumber: number
  changeType: VersionChangeType
  createdAt: number
}

/** R2 图片附件元数据 */
export interface Attachment {
  id: string
  noteId: string | null
  filename: string
  mimeType: string
  size: number
  url: string
  createdAt: number
}

/** 管理后台用户用量摘要 */
export interface AdminUserSummary {
  id: string
  username: string
  email: string
  role: UserRole
  status: UserStatus
  lastLoginAt: number | null
  createdAt: number
  noteCount: number
  folderCount: number
  attachmentCount: number
  storageBytes: number
}

/** 管理后台统计概览结构 */
export interface AdminStats {
  users: {
    total: number
    active: number
    disabled: number
    admins: number
  }
  notes: {
    total: number
    markdown: number
    plain: number
    pinned: number
  }
  folders: {
    total: number
  }
  versions: {
    totalLast7Days: number
  }
  attachments: {
    totalCount: number
    totalSizeBytes: number
  }
  recentLogins: User[]
  userSummaries: AdminUserSummary[]
}
