/**
 * 业务常量与输入校验工具函数模块
 */

/** 笔记历史版本保留时长：7 天（一周） */
export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

/** 标准登录会话有效期：24 小时 */
export const SESSION_SHORT_MS = 24 * 60 * 60 * 1000

/** 长时间自动登录会话有效期：30 天 */
export const SESSION_LONG_MS = 30 * 24 * 60 * 60 * 1000

/** 图片验证码有效期：5 分钟 */
export const CAPTCHA_TTL_MS = 5 * 60 * 1000

/** 单张上传图片最大大小：5 MB（适配免费额度并避免大文件滥用） */
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024

/** 允许上传的静态安全图片 MIME 类型映射及扩展名 */
export const ALLOWED_IMAGE_MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp'
}

/** Cookie 中保存会话令牌的键名 */
export const SESSION_COOKIE_NAME = 'candy_session'

/**
 * 校验邮箱格式是否合法
 */
export function isValidEmail(email: string): boolean {
  if (!email || email.length > 120) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

/**
 * 校验用户昵称（用户名）是否合法
 * 规则：2-32 个字符，不允许包含 @ 或空白字符，避免与邮箱登录标识冲突
 */
export function isValidUsername(username: string): boolean {
  if (!username) return false
  const trimmed = username.trim()
  if (trimmed.length < 2 || trimmed.length > 32) return false
  if (trimmed.includes('@') || /\s/.test(trimmed)) return false
  return true
}

/**
 * 校验密码强度是否满足最低长度要求（6-128 字符）
 */
export function isValidPassword(password: string): boolean {
  return typeof password === 'string' && password.length >= 6 && password.length <= 128
}

/**
 * 清理上传文件名，去除路径分隔符与不安全字符
 */
export function sanitizeFilename(filename: string): string {
  const base = filename.split(/[/\\]/).pop() || 'image'
  const cleaned = base.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_').slice(0, 80)
  return cleaned || 'image'
}

/**
 * 解析 HTTP Cookie 请求头获取指定键名的值
 */
export function parseCookieValue(cookieHeader: string | undefined, key: string): string | null {
  if (!cookieHeader) return null
  const pairs = cookieHeader.split(';')
  for (const pair of pairs) {
    const idx = pair.indexOf('=')
    if (idx === -1) continue
    const k = pair.slice(0, idx).trim()
    if (k === key) {
      return decodeURIComponent(pair.slice(idx + 1).trim())
    }
  }
  return null
}
