import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderMarkdownSafe } from '@/utils/markdown'

/**
 * Markdown 安全解析、外链新标签页打开、XSS 防护及日夜间代码块样式单元测试
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

  it('应过滤恶意 <script> 标签、内联事件及危险协议防止 XSS 攻击', () => {
    const malicious = [
      '# Test',
      '',
      '<script>alert("xss")</script>',
      '',
      '<img src="x" onerror="alert(1)">',
      '',
      '<a href="javascript:alert(1)">恶意HTML链接</a>',
      '',
      '[恶意Markdown链接](javascript:alert(1))'
    ].join('\n')

    const html = renderMarkdownSafe(malicious)
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('onerror')
    expect(html).toContain('<h1>Test</h1>')

    const doc = new DOMParser().parseFromString(html, 'text/html')
    const anchors = Array.from(doc.querySelectorAll('a'))
    for (const a of anchors) {
      expect(a.getAttribute('href') || '').not.toMatch(/^javascript:/i)
      expect(a.getAttribute('target')).toBeNull()
    }
  })

  it('点击笔记中的外部 URL 与裸链接时应附加 target="_blank" 与安全 rel 属性以新开标签页', () => {
    const md = [
      '[官网](https://example.com)',
      '',
      '裸网址：https://cloudflare.com/workers?tab=free',
      '',
      '自动域名：www.github.com',
      '',
      '[同页锚点](#heading)',
      '',
      '[发送邮件](mailto:support@candynote.dev)'
    ].join('\n')

    const html = renderMarkdownSafe(md)
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const links = Array.from(doc.querySelectorAll('a'))

    const externalLinks = links.filter((a) =>
      ['https://example.com', 'https://cloudflare.com/workers?tab=free', 'http://www.github.com'].includes(
        a.getAttribute('href') || ''
      )
    )
    expect(externalLinks).toHaveLength(3)
    for (const a of externalLinks) {
      expect(a.getAttribute('target')).toBe('_blank')
      expect(a.getAttribute('rel')).toContain('noopener')
      expect(a.getAttribute('rel')).toContain('noreferrer')
    }

    // 页内锚点与邮件链接保持同页/默认协议行为，不强制新开空白标签页
    const anchorLink = links.find((a) => a.getAttribute('href') === '#heading')
    const mailLink = links.find((a) => a.getAttribute('href') === 'mailto:support@candynote.dev')
    expect(anchorLink?.getAttribute('target')).toBeNull()
    expect(mailLink?.getAttribute('target')).toBeNull()
  })

  it('Markdown 代码块与行内代码样式应明确区分日间模式浅色配色与夜间模式深色配色', () => {
    const html = renderMarkdownSafe('行内 `const a = 1`\n\n```ts\nconsole.log("hi")\n```')
    expect(html).toContain('<code>const a = 1</code>')
    expect(html).toContain('<pre><code class="language-ts">')

    const css = readFileSync(resolve(process.cwd(), 'src/style.css'), 'utf8')
    // 日间模式 pre 代码块不应硬编码深色背景 #0f172a
    const lightPreMatch = css.match(/\.candy-markdown-body pre\s*\{([^}]*)\}/)
    expect(lightPreMatch).not.toBeNull()
    expect(lightPreMatch![1]).toContain('#f1f5f9')
    expect(lightPreMatch![1]).toContain('#1e293b')
    expect(lightPreMatch![1]).not.toContain('#0f172a')

    // 夜间模式 html.dark 下应独立覆盖为深色代码块样式
    const darkPreMatch = css.match(/html\.dark \.candy-markdown-body pre\s*\{([^}]*)\}/)
    expect(darkPreMatch).not.toBeNull()
    expect(darkPreMatch![1]).toContain('#0f172a')
    expect(darkPreMatch![1]).toContain('#e2e8f0')
  })
})
