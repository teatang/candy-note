import DOMPurify from 'dompurify'
import { Marked } from 'marked'

/**
 * 配置支持 GitHub Flavored Markdown (表格、任务列表、换行) 的解析器实例
 */
const markedParser = new Marked({
  gfm: true,
  breaks: true
})

/**
 * 将 Markdown 文本安全渲染为经过 XSS 净化的 HTML 字符串
 * 允许保留相对路径的图片链接（如 /api/files/:id），过滤危险脚本与事件属性
 */
export function renderMarkdownSafe(markdown: string): string {
  if (!markdown) return ''
  const rawHtml = markedParser.parse(markdown, { async: false }) as string
  return DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel']
  })
}
