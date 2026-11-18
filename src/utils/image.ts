/**
 * 图片预处理与高质量压缩工具模块
 * 用于在前端将图片上传到 Cloudflare R2 前进行无损/近无损画质压缩
 */

export interface CompressImageOptions {
  /** 最大尺寸（宽或高），超过则按原宽高比等比缩小，默认 2560px（满足超清视网膜屏幕显示） */
  maxDimension?: number
  /** 压缩质量 (0.1 - 1.0)，默认 0.90（肉眼无损画质，保留细腻边缘与色彩） */
  quality?: number
  /** 小于等于此体积（字节）的图片跳过压缩，默认 100KB */
  minSizeBytes?: number
}

/**
 * 释放位图资源
 */
function closeBitmap(bitmap: unknown) {
  if (bitmap && typeof (bitmap as ImageBitmap).close === 'function') {
    try {
      ;(bitmap as ImageBitmap).close()
    } catch {
      // 忽略关闭异常
    }
  }
}

/**
 * 跨环境获取图片宽高并转为可绘制源（优先使用高性能的 createImageBitmap，降级为 Image 对象）
 */
async function loadDrawableImage(
  file: File
): Promise<{ width: number; height: number; source: CanvasImageSource; close?: () => void } | null> {
  // 1. 尝试使用现代浏览器原生 createImageBitmap（高性能、低内存占用）
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file)
      return {
        width: bitmap.width,
        height: bitmap.height,
        source: bitmap,
        close: () => closeBitmap(bitmap)
      }
    } catch {
      // 某些格式或环境若失败，继续降级到 Image 标签方案
    }
  }

  // 2. 降级使用 Image 对象与 URL.createObjectURL
  if (
    typeof Image === 'function' &&
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function'
  ) {
    return new Promise((resolve) => {
      let objectUrl = ''
      try {
        objectUrl = URL.createObjectURL(file)
      } catch {
        return resolve(null)
      }

      const img = new Image()
      img.onload = () => {
        try {
          if (objectUrl) URL.revokeObjectURL(objectUrl)
        } catch {
          // 忽略释放异常
        }
        resolve({
          width: img.naturalWidth || img.width,
          height: img.naturalHeight || img.height,
          source: img
        })
      }
      img.onerror = () => {
        try {
          if (objectUrl) URL.revokeObjectURL(objectUrl)
        } catch {
          // 忽略释放异常
        }
        resolve(null)
      }
      img.src = objectUrl
    })
  }

  return null
}

/**
 * 在上传图片前对图片进行无损/近无损画质压缩
 *
 * 优化策略：
 * 1. 动图保护：GIF 格式直接跳过，防止多帧动画丢失。
 * 2. 小图保护：小于 100KB 的图片直接跳过，避免轻量图二次编码损耗。
 * 3. 超高清视网膜显示保护：仅当单边超大（> 2560px）时按原比例平滑缩放，普通尺寸保持 1:1 原分辨率。
 * 4. 画质保护：采用高质量平滑插值（high smoothing），JPEG/WebP 输出 0.90 极致保真质量。
 * 5. 体积兜底保护：压缩后仅当文件体积真正缩小才使用压缩结果，若未变小则无条件保留原文件。
 * 6. 异常容错：环境不支持或任何加载异常均安全降级并返回原文件，确保上传链路绝对稳定。
 *
 * @param file 原始图片 File 对象
 * @param options 可选压缩参数
 * @returns 优化压缩后的 File 对象（若无需压缩或未变小则返回原 File）
 */
export async function compressImage(
  file: File,
  options: CompressImageOptions = {}
): Promise<File> {
  const {
    maxDimension = 2560,
    quality = 0.90,
    minSizeBytes = 100 * 1024
  } = options

  // 非图片文件直接返回
  if (!file.type.startsWith('image/')) {
    return file
  }

  // GIF 动图跳过压缩，保护多帧动态效果
  if (file.type === 'image/gif') {
    return file
  }

  // 小于阈值的文件跳过压缩
  if (file.size <= minSizeBytes) {
    return file
  }

  // 检查浏览器 Canvas 环境（兼容 Node/jsdom 测试环境）
  if (
    typeof window === 'undefined' ||
    typeof document === 'undefined' ||
    typeof HTMLCanvasElement === 'undefined'
  ) {
    return file
  }

  try {
    const drawable = await loadDrawableImage(file)
    if (!drawable) {
      return file
    }

    const { width, height, source, close } = drawable
    if (width <= 0 || height <= 0) {
      if (close) close()
      return file
    }

    // 计算目标尺寸：超过 maxDimension 时等比缩小，未超过则保持原始清晰度
    let targetWidth = width
    let targetHeight = height
    if (width > maxDimension || height > maxDimension) {
      const ratio = Math.min(maxDimension / width, maxDimension / height)
      targetWidth = Math.max(1, Math.round(width * ratio))
      targetHeight = Math.max(1, Math.round(height * ratio))
    }

    // 创建离屏 Canvas 并绘制
    const canvas = document.createElement('canvas')
    canvas.width = targetWidth
    canvas.height = targetHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      if (close) close()
      return file
    }

    // 启用最高质量的图像平滑插值算法
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(source, 0, 0, targetWidth, targetHeight)
    if (close) close()

    // 目标编码类型与质量
    const targetMime =
      file.type === 'image/png'
        ? 'image/png'
        : file.type === 'image/webp'
          ? 'image/webp'
          : 'image/jpeg'
    const targetQuality = targetMime === 'image/png' ? undefined : quality

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(
        (b) => resolve(b),
        targetMime,
        targetQuality
      )
    })

    // 释放 Canvas 显存
    canvas.width = 0
    canvas.height = 0

    if (!blob || blob.size === 0) {
      return file
    }

    // 关键校验：若压缩后体积没有更小，保留原始文件，绝不负优化
    if (blob.size >= file.size) {
      return file
    }

    // 返回压缩后的 File 对象，保留原始文件名与修改时间戳
    return new File([blob], file.name, {
      type: blob.type || targetMime,
      lastModified: file.lastModified || Date.now()
    })
  } catch {
    // 任何环节发生未知异常，静默降级返回原文件
    return file
  }
}
