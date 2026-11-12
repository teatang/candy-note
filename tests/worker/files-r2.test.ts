import { describe, expect, it } from 'vitest'
import { createTestHarness } from '../helpers/testApp'

/**
 * Cloudflare R2 图片上传、读取与联动清理单元测试
 */
describe('Cloudflare R2 Image Storage API', () => {
  it('支持上传图片到 R2 对象存储、按权限读取图片并在删除笔记时同步清理 R2', async () => {
    const harness = createTestHarness()
    try {
      const admin = await harness.loginAsAdmin()

      const noteRes = await harness.request(
        '/api/notes',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: '带图笔记', content: '', format: 'markdown' })
        },
        admin.cookie
      )
      const { note } = (await noteRes.json()) as { note: { id: string } }

      const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
      const form = new FormData()
      form.append('file', new File([pngBytes], 'candy.png', { type: 'image/png' }))
      form.append('noteId', note.id)

      const uploadRes = await harness.request(
        '/api/files/upload',
        { method: 'POST', body: form },
        admin.cookie
      )
      expect(uploadRes.status).toBe(201)
      const { attachment } = (await uploadRes.json()) as {
        attachment: { id: string; url: string; size: number; mimeType: string }
      }
      expect(attachment.url).toBe(`/api/files/${attachment.id}`)
      expect(attachment.size).toBe(8)
      expect(harness.r2.store.size).toBe(1)

      // 合法用户应能读取图片二进制流
      const getRes = await harness.request(attachment.url, {}, admin.cookie)
      expect(getRes.status).toBe(200)
      expect(getRes.headers.get('content-type')).toBe('image/png')
      const receivedBytes = new Uint8Array(await getRes.arrayBuffer())
      expect(Array.from(receivedBytes)).toEqual(Array.from(pngBytes))

      // 未登录请求应被拒绝
      const unauthGet = await harness.request(attachment.url)
      expect(unauthGet.status).toBe(401)

      // 删除笔记时应自动清理 R2 中的图片对象
      const delNoteRes = await harness.request(
        `/api/notes/${note.id}`,
        { method: 'DELETE' },
        admin.cookie
      )
      expect(delNoteRes.status).toBe(200)
      expect(harness.r2.store.size).toBe(0)
    } finally {
      harness.db.close()
    }
  })

  it('应拦截不支持的文件类型及超过 5MB 的大图片', async () => {
    const harness = createTestHarness()
    try {
      const admin = await harness.loginAsAdmin()

      // 拦截非安全图片 MIME（如 SVG/TXT）
      const badMimeForm = new FormData()
      badMimeForm.append('file', new File(['<svg></svg>'], 'evil.svg', { type: 'image/svg+xml' }))
      const badMimeRes = await harness.request(
        '/api/files/upload',
        { method: 'POST', body: badMimeForm },
        admin.cookie
      )
      expect(badMimeRes.status).toBe(400)
      expect(((await badMimeRes.json()) as { code: string }).code).toBe('FILE_INVALID_TYPE')

      // 拦截超限大文件
      const bigBuffer = new Uint8Array(5 * 1024 * 1024 + 10)
      const bigForm = new FormData()
      bigForm.append('file', new File([bigBuffer], 'huge.png', { type: 'image/png' }))
      const bigRes = await harness.request(
        '/api/files/upload',
        { method: 'POST', body: bigForm },
        admin.cookie
      )
      expect(bigRes.status).toBe(400)
      expect(((await bigRes.json()) as { code: string }).code).toBe('FILE_TOO_LARGE')
    } finally {
      harness.db.close()
    }
  })
})
