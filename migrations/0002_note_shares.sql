-- 糖果笔记 (Candy Note) 数据库迁移脚本：0002_note_shares
-- 为 notes 笔记主表添加附属分享表 note_shares，用于控制笔记公开/密码访问分享配置

CREATE TABLE IF NOT EXISTS note_shares (
  id TEXT PRIMARY KEY,                                            -- 分享记录唯一 ID (UUID)
  note_id TEXT NOT NULL UNIQUE REFERENCES notes(id) ON DELETE CASCADE, -- 关联笔记 ID（唯一约束）
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,   -- 所属用户 ID
  share_code TEXT NOT NULL UNIQUE,                                -- 公开访问短码
  is_enabled INTEGER NOT NULL DEFAULT 1,                          -- 是否启用分享 (1=开启, 0=关闭)
  has_password INTEGER NOT NULL DEFAULT 0,                        -- 是否需要密码 (1=需要, 0=公开)
  password_hash TEXT,                                             -- PBKDF2 访问密码哈希
  share_password TEXT,                                            -- 访问密码明文（用于分享链接和所有者回显）
  expires_at INTEGER,                                             -- 过期时间戳毫秒 (NULL=永久有效)
  view_count INTEGER NOT NULL DEFAULT 0,                          -- 访问查看次数
  created_at INTEGER NOT NULL,                                    -- 创建时间戳 (毫秒)
  updated_at INTEGER NOT NULL                                     -- 更新时间戳 (毫秒)
);

CREATE INDEX IF NOT EXISTS idx_note_shares_note ON note_shares(note_id);
CREATE INDEX IF NOT EXISTS idx_note_shares_user ON note_shares(user_id);
CREATE INDEX IF NOT EXISTS idx_note_shares_code ON note_shares(share_code);
CREATE INDEX IF NOT EXISTS idx_note_shares_expires ON note_shares(expires_at);
