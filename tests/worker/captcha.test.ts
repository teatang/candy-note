import { describe, expect, it } from 'vitest'
import { generateCaptchaCode, renderCaptchaSvg, svgToDataUri } from '@worker/utils/captcha'
import { createTestHarness } from '../helpers/testApp'

/**
 * SVG 图片验证码生成与一次性消费单元测试
 */
describe('SVG Captcha Module', () => {
  it('生成的验证码应剔除易混淆字符并正确渲染为 SVG Data URI', () => {
    for (let i = 0; i < 20; i++) {
      const code = generateCaptchaCode(4)
      expect(code).toHaveLength(4)
      expect(code).not.toMatch(/[01OIL]/)
    }

    const svg = renderCaptchaSvg('ABCD')
    expect(svg).toContain('<svg')
    expect(svg).toContain('>A</text>')
    expect(svg).toContain('>D</text>')

    const uri = svgToDataUri(svg)
    expect(uri.startsWith('data:image/svg+xml;base64,')).toBe(true)
  })

  it('过期或已被校验使用过的验证码不能重复使用', async () => {
    const harness = createTestHarness()
    try {
      const captcha = await harness.fetchCaptcha()
      expect(captcha.code).toHaveLength(4)

      // 首次提交错误验证码，应提示验证码错误并立即销毁该验证码记录
      const badLogin = await harness.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: 'admin',
          password: 'TestAdminPassword123!',
          captchaId: captcha.captchaId,
          captchaCode: 'ZZZZ'
        })
      })
      expect(badLogin.status).toBe(400)
      const badBody = (await badLogin.json()) as { code: string }
      expect(badBody.code).toBe('AUTH_INVALID_CAPTCHA')

      // 即使用正确验证码再次重放同一 captchaId，也应失败
      const replayLogin = await harness.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: 'admin',
          password: 'TestAdminPassword123!',
          captchaId: captcha.captchaId,
          captchaCode: captcha.code
        })
      })
      expect(replayLogin.status).toBe(400)
    } finally {
      harness.db.close()
    }
  })
})
