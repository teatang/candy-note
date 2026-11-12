import { describe, expect, it } from 'vitest'
import {
  generateSessionToken,
  hashPassword,
  sha256Hex,
  timingSafeEqual,
  verifyPassword
} from '@worker/utils/crypto'

/**
 * 密码学与安全工具单元测试
 */
describe('Crypto Utilities', () => {
  it('应使用随机盐值生成 PBKDF2 密码哈希并正确验证匹配密码', async () => {
    const hash1 = await hashPassword('CandyNote2026!')
    const hash2 = await hashPassword('CandyNote2026!')

    expect(hash1).toMatch(/^pbkdf2_sha256\$50000\$[a-f0-9]+\$[a-f0-9]+$/)
    expect(hash1).not.toBe(hash2)
    expect(await verifyPassword('CandyNote2026!', hash1)).toBe(true)
    expect(await verifyPassword('WrongPassword!', hash1)).toBe(false)
    expect(await verifyPassword('CandyNote2026!', 'invalid-hash-format')).toBe(false)
  })

  it('应正确计算 SHA-256 摘要并执行恒定时间字节数组比较', async () => {
    const digest = await sha256Hex('candy-note')
    expect(digest).toHaveLength(64)
    expect(digest).toBe(await sha256Hex('candy-note'))

    const a = new Uint8Array([1, 2, 3, 4])
    const b = new Uint8Array([1, 2, 3, 4])
    const c = new Uint8Array([1, 2, 3, 5])
    expect(timingSafeEqual(a, b)).toBe(true)
    expect(timingSafeEqual(a, c)).toBe(false)
    expect(timingSafeEqual(a, new Uint8Array([1, 2]))).toBe(false)
  })

  it('应生成高熵不重复的 URL 安全会话令牌', () => {
    const t1 = generateSessionToken()
    const t2 = generateSessionToken()
    expect(t1.length).toBeGreaterThanOrEqual(40)
    expect(t1).not.toBe(t2)
    expect(t1).not.toMatch(/[+/=]/)
  })
})
