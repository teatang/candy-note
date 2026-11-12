-- 糖果笔记 (Candy Note) Cloudflare D1 初始化数据库迁移脚本
-- 注意：Cloudflare D1 默认开启外键约束，执行迁移后将自动创建多用户云笔记核心表结构

-- 1. 用户表：仅支持后台管理员手动添加，不开放前台注册
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,                                        -- 用户唯一标识 (UUID)
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,               -- 用户昵称（支持作为登录用户名，不区分大小写唯一）
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,                  -- 用户邮箱（支持作为登录用户名，不区分大小写唯一）
  password_hash TEXT NOT NULL,                                -- PBKDF2-SHA256 加盐密码哈希
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')), -- 角色：admin 管理员 / user 普通用户
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')), -- 状态：active 启用 / disabled 禁用
  must_change_password INTEGER NOT NULL DEFAULT 0,            -- 是否建议修改默认密码 (0/1)
  created_at INTEGER NOT NULL,                                -- 创建时间戳 (毫秒)
  updated_at INTEGER NOT NULL,                                -- 更新时间戳 (毫秒)
  last_login_at INTEGER                                       -- 最近登录时间戳 (毫秒)
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- 2. 会话表：支持标准会话与 30 天长时间自动登录
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,                                        -- 会话唯一 ID
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- 关联用户 ID
  token_hash TEXT NOT NULL UNIQUE,                            -- 会话令牌的 SHA-256 哈希值（不存明文 Token）
  remember_me INTEGER NOT NULL DEFAULT 0,                     -- 是否启用长时间自动登录 (1=30天, 0=24小时)
  user_agent TEXT,                                            -- 客户端 User-Agent 摘要
  created_at INTEGER NOT NULL,                                -- 创建时间戳 (毫秒)
  expires_at INTEGER NOT NULL,                                -- 过期时间戳 (毫秒)
  last_active_at INTEGER NOT NULL                             -- 最后活跃时间戳 (毫秒)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- 3. 图片验证码表：一次性校验并快速过期
CREATE TABLE IF NOT EXISTS captchas (
  id TEXT PRIMARY KEY,                                        -- 验证码会话 ID
  code_hash TEXT NOT NULL,                                    -- 验证码内容加盐 SHA-256 哈希
  expires_at INTEGER NOT NULL,                                -- 过期时间戳 (毫秒，默认 5 分钟)
  created_at INTEGER NOT NULL                                 -- 创建时间戳 (毫秒)
);

CREATE INDEX IF NOT EXISTS idx_captchas_expires_at ON captchas(expires_at);

-- 4. 笔记文件夹表：支持多级目录与任意拖动排序
CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,                                        -- 文件夹 ID (UUID)
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- 所属用户 ID
  parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,    -- 父文件夹 ID（为 NULL 表示顶级文件夹）
  name TEXT NOT NULL,                                         -- 文件夹名称
  sort_order INTEGER NOT NULL DEFAULT 0,                      -- 拖动排序序号（数值越小越靠前）
  created_at INTEGER NOT NULL,                                -- 创建时间戳 (毫秒)
  updated_at INTEGER NOT NULL                                 -- 更新时间戳 (毫秒)
);

CREATE INDEX IF NOT EXISTS idx_folders_user_sort ON folders(user_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id);

-- 5. 笔记主表：支持普通文本 (plain) 与 Markdown (markdown)，支持置顶与拖动排序
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,                                        -- 笔记 ID (UUID)
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- 所属用户 ID
  folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,   -- 所属文件夹 ID（为 NULL 表示未分类/根目录）
  title TEXT NOT NULL DEFAULT '',                             -- 笔记标题
  content TEXT NOT NULL DEFAULT '',                           -- 笔记正文内容
  format TEXT NOT NULL DEFAULT 'markdown' CHECK (format IN ('plain', 'markdown')), -- 格式：plain 纯文本 / markdown
  is_pinned INTEGER NOT NULL DEFAULT 0,                       -- 是否置顶 (0=否, 1=是)
  pinned_at INTEGER,                                          -- 置顶时间戳 (毫秒)
  sort_order INTEGER NOT NULL DEFAULT 0,                      -- 自定义拖动排序序号
  created_at INTEGER NOT NULL,                                -- 创建时间戳 (毫秒)
  updated_at INTEGER NOT NULL                                 -- 更新时间戳 (毫秒)
);

CREATE INDEX IF NOT EXISTS idx_notes_user_folder ON notes(user_id, folder_id);
CREATE INDEX IF NOT EXISTS idx_notes_user_pin_sort ON notes(user_id, is_pinned DESC, sort_order ASC, updated_at DESC);

-- 6. 笔记历史版本表：保留最近一周（7 天）内的历史快照，支持一键回退
CREATE TABLE IF NOT EXISTS note_versions (
  id TEXT PRIMARY KEY,                                        -- 版本记录 ID (UUID)
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE, -- 关联笔记 ID
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- 所属用户 ID
  title TEXT NOT NULL,                                        -- 该版本标题快照
  content TEXT NOT NULL,                                      -- 该版本正文快照
  format TEXT NOT NULL CHECK (format IN ('plain', 'markdown')), -- 该版本格式快照
  folder_id TEXT,                                             -- 当时所属文件夹 ID
  version_number INTEGER NOT NULL,                            -- 递增版本号
  change_type TEXT NOT NULL DEFAULT 'save',                   -- 变更类型：create / save / auto_save / before_rollback
  created_at INTEGER NOT NULL                                 -- 快照创建时间戳 (毫秒)
);

CREATE INDEX IF NOT EXISTS idx_note_versions_note_time ON note_versions(note_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_note_versions_created ON note_versions(created_at);

-- 7. R2 图片附件元数据表：记录上传至 Cloudflare R2 的图片信息，便于统计、鉴权与清理
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,                                        -- 附件 ID (UUID)
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- 上传者用户 ID
  note_id TEXT REFERENCES notes(id) ON DELETE SET NULL,       -- 关联笔记 ID（可为空）
  r2_key TEXT NOT NULL UNIQUE,                                -- Cloudflare R2 对象存储 Key
  filename TEXT NOT NULL,                                     -- 原始文件名
  mime_type TEXT NOT NULL,                                    -- 图片 MIME 类型
  size INTEGER NOT NULL,                                      -- 文件大小（字节）
  created_at INTEGER NOT NULL                                 -- 上传时间戳 (毫秒)
);

CREATE INDEX IF NOT EXISTS idx_attachments_user ON attachments(user_id);
CREATE INDEX IF NOT EXISTS idx_attachments_note ON attachments(note_id);
