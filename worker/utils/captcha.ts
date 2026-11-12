/**
 * 图片验证码生成与 SVG 渲染模块
 * 专为无原生 Canvas 二进制的 Cloudflare Workers 环境设计，输出可直接在 <img> 中展示的 SVG Data URI
 */

/** 剔除易混淆字符（0/O, 1/I/L）后的安全字符集 */
const CAPTCHA_CHARSET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

/** 糖果主题文字配色板，确保在浅色噪点背景上具备良好可读性 */
const CANDY_TEXT_COLORS = [
  '#e11d48', // 草莓红
  '#db2777', // 樱花粉
  '#9333ea', // 葡萄紫
  '#4f46e5', // 蓝莓靛
  '#0284c7', // 苏打蓝
  '#059669', // 薄荷绿
  '#d97706'  // 焦糖橙
]

/**
 * 生成随机整数 [min, max]
 */
function randomInt(min: number, max: number): number {
  const range = max - min + 1
  const arr = new Uint32Array(1)
  crypto.getRandomValues(arr)
  return min + (arr[0] % range)
}

/**
 * 生成指定长度的随机验证码文本
 */
export function generateCaptchaCode(length = 4): string {
  let code = ''
  for (let i = 0; i < length; i++) {
    const idx = randomInt(0, CAPTCHA_CHARSET.length - 1)
    code += CAPTCHA_CHARSET[idx]
  }
  return code
}

/**
 * 将验证码文本渲染为包含扭曲旋转、干扰线与噪点的 SVG 字符串
 */
export function renderCaptchaSvg(code: string): string {
  const width = 136
  const height = 44

  // 生成 4 条随机贝塞尔干扰曲线
  const lines: string[] = []
  for (let i = 0; i < 4; i++) {
    const x1 = randomInt(0, 25)
    const y1 = randomInt(5, height - 5)
    const cx = randomInt(35, width - 35)
    const cy = randomInt(2, height - 2)
    const x2 = randomInt(width - 25, width)
    const y2 = randomInt(5, height - 5)
    const color = CANDY_TEXT_COLORS[randomInt(0, CANDY_TEXT_COLORS.length - 1)]
    lines.push(
      `<path d="M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}" stroke="${color}" stroke-width="1.3" stroke-opacity="0.35" fill="none"/>`
    )
  }

  // 生成 24 个随机背景噪点
  const dots: string[] = []
  for (let i = 0; i < 24; i++) {
    const cx = randomInt(4, width - 4)
    const cy = randomInt(4, height - 4)
    const r = (randomInt(8, 16) / 10).toFixed(1)
    const color = CANDY_TEXT_COLORS[randomInt(0, CANDY_TEXT_COLORS.length - 1)]
    dots.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" fill-opacity="0.28"/>`)
  }

  // 生成每个旋转变形的验证码字符
  const charStep = Math.floor((width - 24) / Math.max(code.length, 1))
  const chars: string[] = []
  for (let i = 0; i < code.length; i++) {
    const x = 16 + i * charStep + randomInt(-2, 3)
    const y = randomInt(28, 34)
    const rotate = randomInt(-22, 22)
    const fontSize = randomInt(22, 26)
    const color = CANDY_TEXT_COLORS[randomInt(0, CANDY_TEXT_COLORS.length - 1)]
    chars.push(
      `<text x="${x}" y="${y}" fill="${color}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="${fontSize}" font-weight="800" transform="rotate(${rotate} ${x} ${y})">${code[i]}</text>`
    )
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="candyBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fff1f2"/>
      <stop offset="50%" stop-color="#fdf4ff"/>
      <stop offset="100%" stop-color="#f0f9ff"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" rx="8" fill="url(#candyBg)"/>
  ${dots.join('')}
  ${lines.join('')}
  ${chars.join('')}
</svg>`
}

/**
 * 将 SVG 字符串编码为 Base64 Data URI 便于前端直接渲染
 */
export function svgToDataUri(svg: string): string {
  const bytes = new TextEncoder().encode(svg)
  let binary = ''
  for (const b of bytes) {
    binary += String.fromCharCode(b)
  }
  return `data:image/svg+xml;base64,${btoa(binary)}`
}
