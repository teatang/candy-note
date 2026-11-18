import { describe, expect, it, vi } from 'vitest'
import { compressImage } from '@/utils/image'

describe('Image Compression Utility', () => {
  it('非图片类型文件应直接跳过压缩并返回原文件', async () => {
    const textFile = new File(['hello world text content'], 'doc.txt', {
      type: 'text/plain'
    })
    const res = await compressImage(textFile)
    expect(res).toBe(textFile)
  })

  it('GIF 格式动图应直接跳过压缩以保护动图帧完整性', async () => {
    const gifFile = new File([new Uint8Array(200 * 1024)], 'animation.gif', {
      type: 'image/gif'
    })
    const res = await compressImage(gifFile)
    expect(res).toBe(gifFile)
  })

  it('小于最小压缩阈值（默认 100KB）的小图片应直接跳过压缩', async () => {
    const smallFile = new File([new Uint8Array(50 * 1024)], 'icon.png', {
      type: 'image/png'
    })
    const res = await compressImage(smallFile)
    expect(res).toBe(smallFile)
  })

  it('在无 Canvas 环境或发生异常时应安全降级返回原文件', async () => {
    const largeFile = new File([new Uint8Array(500 * 1024)], 'photo.jpg', {
      type: 'image/jpeg'
    })
    // 默认 jsdom 环境下无真实 Canvas 图像渲染管道，自动触发优雅降级
    const res = await compressImage(largeFile)
    expect(res).toBe(largeFile)
  })

  it('当提供 Canvas 压缩环境且输出更小时，应返回高质量压缩后的 File 对象', async () => {
    const originalBytes = new Uint8Array(800 * 1024) // 800KB
    const largeFile = new File([originalBytes], 'large-photo.jpg', {
      type: 'image/jpeg',
      lastModified: 1700000000000
    })

    // Mock createImageBitmap
    const mockBitmap = {
      width: 4000,
      height: 3000,
      close: vi.fn()
    }
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(mockBitmap))

    // Mock canvas and 2d context
    const drawImageSpy = vi.fn()
    const mockCtx = {
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
      drawImage: drawImageSpy
    }

    const compressedBlob = new Blob([new Uint8Array(250 * 1024)], { type: 'image/jpeg' }) // 250KB
    const originalCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName === 'canvas') {
        const canvas = originalCreateElement('canvas')
        canvas.getContext = vi.fn().mockReturnValue(mockCtx)
        canvas.toBlob = vi.fn((cb: BlobCallback, mime?: string, quality?: any) => {
          expect(mime).toBe('image/jpeg')
          expect(quality).toBe(0.9)
          cb(compressedBlob)
        })
        return canvas
      }
      return originalCreateElement(tagName)
    })

    try {
      const result = await compressImage(largeFile)
      expect(result).not.toBe(largeFile)
      expect(result.name).toBe('large-photo.jpg')
      expect(result.type).toBe('image/jpeg')
      expect(result.size).toBe(250 * 1024)
      expect(result.lastModified).toBe(1700000000000)

      // 验证按 2560 等比缩放计算：4000x3000 -> 2560x1920
      expect(drawImageSpy).toHaveBeenCalledWith(
        mockBitmap,
        0,
        0,
        2560,
        1920
      )
      expect(mockCtx.imageSmoothingEnabled).toBe(true)
      expect(mockCtx.imageSmoothingQuality).toBe('high')
      expect(mockBitmap.close).toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
      vi.restoreAllMocks()
    }
  })

  it('若压缩后体积未减小（例如输出比原图大），应舍弃压缩结果并保留原图', async () => {
    const originalBytes = new Uint8Array(200 * 1024) // 200KB
    const file = new File([originalBytes], 'compressed.jpg', {
      type: 'image/jpeg'
    })

    const mockBitmap = {
      width: 1920,
      height: 1080,
      close: vi.fn()
    }
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(mockBitmap))

    const mockCtx = {
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
      drawImage: vi.fn()
    }

    // 假设二次编码后体积反而增加为 250KB
    const largerBlob = new Blob([new Uint8Array(250 * 1024)], { type: 'image/jpeg' })
    const originalCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName === 'canvas') {
        const canvas = originalCreateElement('canvas')
        canvas.getContext = vi.fn().mockReturnValue(mockCtx)
        canvas.toBlob = vi.fn((cb: BlobCallback) => {
          cb(largerBlob)
        })
        return canvas
      }
      return originalCreateElement(tagName)
    })

    try {
      const result = await compressImage(file)
      // 体积未缩小，必须原样保留
      expect(result).toBe(file)
      expect(result.size).toBe(200 * 1024)
    } finally {
      vi.unstubAllGlobals()
      vi.restoreAllMocks()
    }
  })
})
