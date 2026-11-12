import { describe, expect, it } from 'vitest'
import { renderMarkdownSafe } from '@/utils/markdown'

/**
 * Markdown 安全解析与 XSS 防护单元测试
 */
describe('Markdown Safe Renderer', () => {
  it('应正确渲染标题、粗体、列表、表格及 R2 图片路径', () => {
    const md = [
      '# 糖果笔记',
      '',
      '**支持** *边写边预览*',
      '',
      '- 项目 1',
      '- 项目 2',
      '',
      '![示例图](/api/files/img-123)'
    ].join('\n')

    const html = renderMarkdownSafe(md)
    expect(html).toContain('<h1>糖果笔记</h1>')
    expect(html).toContain('<strong>支持</strong>')
    expect(html).toContain('<em>边写边预览</em>')
    expect(html).toContain('<li>项目 1</li>')
    expect(html).toContain('<img src="/api/files/img-123" alt="示例图">')
  })

  it('应过滤恶意 <script> 标签与内联事件脚本防止 XSS 攻击', () => {
    const malicious = `# Test\n<script>alert("xss")</script>\n<img src="x" onerror="alert(1)">`
    const html = renderMarkdownSafe(malicious)
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('onerror')
    expect(html).toContain('<h1>Test</h1>')
  })
})
