/**
 * Candy Note Cloudflare D1 核心数据库表结构初始化定义
 * 与 migrations/0001_init.sql 保持完全一致（全部使用 CREATE TABLE / INDEX IF NOT EXISTS 幂等语句）
 * 用于在本地测试环境（wrangler dev）或尚未手动执行 D1 迁移的空白环境中自动兜底建表，避免出现 no such table: users
 */
export const SCHEMA_STATEMENTS: readonly string[] = [
  // 1. 用户表：仅支持后台管理员手动添加，不开放前台注册
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    must_change_password INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_login_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)`,
  `CREATE INDEX IF NOT EXISTS idx_users_status ON users(status)`,

  // 2. 会话表：支持标准会话与 30 天长时间自动登录
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    remember_me INTEGER NOT NULL DEFAULT 0,
    user_agent TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_active_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)`,

  // 3. 图片验证码表：一次性校验并快速过期
  `CREATE TABLE IF NOT EXISTS captchas (
    id TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_captchas_expires_at ON captchas(expires_at)`,

  // 4. 笔记文件夹表：支持多级目录与任意拖动排序
  `CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_folders_user_sort ON folders(user_id, sort_order)`,
  `CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id)`,

  // 5. 笔记主表：支持普通文本 (plain) 与 Markdown (markdown)，支持置顶与拖动排序
  `CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    format TEXT NOT NULL DEFAULT 'markdown' CHECK (format IN ('plain', 'markdown')),
    is_pinned INTEGER NOT NULL DEFAULT 0,
    pinned_at INTEGER,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_notes_user_folder ON notes(user_id, folder_id)`,
  `CREATE INDEX IF NOT EXISTS idx_notes_user_pin_sort ON notes(user_id, is_pinned DESC, sort_order ASC, updated_at DESC)`,

  // 6. 笔记历史版本表：保留最近一周（7 天）内的历史快照，支持一键回退
  `CREATE TABLE IF NOT EXISTS note_versions (
    id TEXT PRIMARY KEY,
    note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    format TEXT NOT NULL CHECK (format IN ('plain', 'markdown')),
    folder_id TEXT,
    version_number INTEGER NOT NULL,
    change_type TEXT NOT NULL DEFAULT 'save',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_note_versions_note_time ON note_versions(note_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_note_versions_created ON note_versions(created_at)`,

  // 7. R2 图片附件元数据表：记录上传至 Cloudflare R2 的图片信息，便于统计、鉴权与清理
  `CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    note_id TEXT REFERENCES notes(id) ON DELETE SET NULL,
    r2_key TEXT NOT NULL UNIQUE,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_attachments_user ON attachments(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_attachments_note ON attachments(note_id)`
]

/** 记录同一 Worker Isolate 内正在进行的建表任务，合并并发冷启动请求 */
const inFlightSchemas = new WeakMap<D1Database, Promise<void>>()

/**
 * 判断异常是否属于 SQLite / D1 缺表错误（例如未执行迁移时的 no such table: users）
 */
export function isNoSuchTableError(err: unknown): boolean {
  const messages: string[] = []
  let current: unknown = err
  // 兼容 wrangler D1_ERROR 将原始 SQLITE_ERROR 包装在 err.cause 中的情况
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (current instanceof Error) {
      messages.push(current.message)
      current = current.cause
    } else if (typeof current === 'string') {
      messages.push(current)
      break
    } else {
      break
    }
  }
  return messages.some((msg) => /no such table/i.test(msg))
}

/**
 * 以原子批处理方式幂等初始化所有数据表及索引
 * 并发冷启动触发时共用同一个 Promise，避免重复执行建表批次
 */
export async function ensureDatabaseSchema(db: D1Database): Promise<void> {
  const pending = inFlightSchemas.get(db)
  if (pending) {
    return pending
  }

  const task = (async () => {
    console.info('[CandyNote] 检测到 D1 数据表尚未初始化，正在自动创建基础表结构...')
    const statements = SCHEMA_STATEMENTS.map((sql) => db.prepare(sql))
    await db.batch(statements)
  })().finally(() => {
    inFlightSchemas.delete(db)
  })

  inFlightSchemas.set(db, task)
  return task
}
