/**
 * 密码学与安全工具模块
 * 基于 Web Crypto API 实现，完全兼容 Cloudflare Workers 边缘运行环境
 */

const PBKDF2_ITERATIONS = 50000
const SALT_BYTES = 16
const KEY_BYTES = 32

/**
 * 生成全局唯一 UUID v4 标识符
 */
export function generateId(): string {
  return crypto.randomUUID()
}

/**
 * 将字节数组转换为十六进制小写字符串
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * 将十六进制字符串还原为字节数组
 */
export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error('无效的十六进制字符串长度')
  }
  const result = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    result[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return result
}

/**
 * 恒定时间字节数组比较函数，防止时序攻击
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i]
  }
  return diff === 0
}

/**
 * 计算输入字符串的 SHA-256 十六进制摘要
 * 用于会话令牌哈希及验证码校验哈希存储
 */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return bytesToHex(new Uint8Array(hashBuffer))
}

/**
 * 使用 PBKDF2-SHA256 算法对明文密码进行加盐哈希
 * 格式：pbkdf2_sha256$<迭代次数>$<随机盐Hex>$<派生密钥Hex>
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  )

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    },
    keyMaterial,
    KEY_BYTES * 8
  )

  const hashHex = bytesToHex(new Uint8Array(derivedBits))
  return `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${bytesToHex(salt)}$${hashHex}`
}

/**
 * 校验明文密码与存储的 PBKDF2 哈希是否匹配
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') {
    return false
  }

  const iterations = Number(parts[1])
  if (!Number.isInteger(iterations) || iterations < 1000 || iterations > 100000) {
    return false
  }

  let salt: Uint8Array
  let expectedBytes: Uint8Array
  try {
    salt = hexToBytes(parts[2])
    expectedBytes = hexToBytes(parts[3])
  } catch {
    return false
  }

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  )

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations,
      hash: 'SHA-256'
    },
    keyMaterial,
    expectedBytes.length * 8
  )

  return timingSafeEqual(new Uint8Array(derivedBits), expectedBytes)
}

/**
 * 生成 256 位随机高熵会话令牌（Base64URL 安全编码）
 */
export function generateSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
