import DOMPurify from 'dompurify'
import { Marked } from 'marked'

/**
 * 配置支持 GitHub Flavored Markdown (表格、任务列表、换行、URL 自动链接) 的解析器实例
 */
const markedParser = new Marked({
  gfm: true,
  breaks: true
})

let linkHookRegistered = false

/**
 * 为 DOMPurify 注册一次性属性后处理钩子：
 * 在 XSS 安全净化完成后，为笔记中渲染的超链接统一附加 `target="_blank"` 与 `rel="noopener noreferrer"`，
 * 确保用户点击笔记中的 URL 时在新标签页中打开，而页内 `#锚点` 与 `mailto:/tel:` 链接保持原行为。
 */
function ensureExternalLinkHook(): void {
  if (linkHookRegistered || typeof DOMPurify.addHook !== 'function') return
  linkHookRegistered = true

  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName?.toLowerCase() !== 'a') return
    const href = node.getAttribute('href')?.trim()
    // 若 href 已被 DOMPurify 净化移除（如 javascript: XSS），或属于页内锚点 / 邮件电话协议，则不强加 _blank
    if (!href || href.startsWith('#') || /^(mailto|tel):/i.test(href)) {
      return
    }

    node.setAttribute('target', '_blank')

    // 保留安全 rel 标记并强制补充 noopener noreferrer，避免新标签页通过 window.opener 反向操纵原页面
    const relSet = new Set(
      (node.getAttribute('rel') || '')
        .split(/\s+/)
        .map((token) => token.trim())
        .filter(Boolean)
    )
    relSet.add('noopener')
    relSet.add('noreferrer')
    node.setAttribute('rel', Array.from(relSet).join(' '))
  })
}

/**
 * 将 Markdown 文本安全渲染为经过 XSS 净化的 HTML 字符串
 * 允许保留相对路径的图片链接（如 /api/files/:id），过滤危险脚本与事件属性，并让外部 URL 默认新开标签页
 */
export function renderMarkdownSafe(markdown: string): string {
  if (!markdown) return ''
  ensureExternalLinkHook()
  const rawHtml = markedParser.parse(markdown, { async: false }) as string
  return DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel']
  })
}
