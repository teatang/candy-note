import type { LocaleCode } from '@/types'

/**
 * 格式化时间戳为本地可读日期时间
 */
export function formatDateTime(timestamp: number | null | undefined, locale: LocaleCode): string {
  if (!timestamp) return '-'
  const date = new Date(timestamp)
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

/**
 * 格式化相对时间（例如：刚刚、5分钟前、2小时前、3天前）
 */
export function formatRelativeTime(timestamp: number, locale: LocaleCode, now = Date.now()): string {
  const diffSec = Math.max(0, Math.floor((now - timestamp) / 1000))
  const isZh = locale === 'zh-CN'

  if (diffSec < 60) {
    return isZh ? '刚刚' : 'just now'
  }
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) {
    return isZh ? `${diffMin} 分钟前` : `${diffMin}m ago`
  }
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) {
    return isZh ? `${diffHour} 小时前` : `${diffHour}h ago`
  }
  const diffDay = Math.floor(diffHour / 24)
  if (diffDay < 7) {
    return isZh ? `${diffDay} 天前` : `${diffDay}d ago`
  }
  return formatDateTime(timestamp, locale)
}

/**
 * 将字节数格式化为人类可读的存储容量单位（B / KB / MB / GB）
 */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const val = bytes / Math.pow(1024, idx)
  return `${val >= 10 || idx === 0 ? val.toFixed(0) : val.toFixed(1)} ${units[idx]}`
}
