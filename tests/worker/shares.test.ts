import { describe, expect, it } from 'vitest'
import { createTestHarness } from '../helpers/testApp'

describe('Note Share API & Public External Access', () => {
  it('应支持创建免密永久分享、获取分享状态、并通过公开短码访问笔记内容', async () => {
    const harness = createTestHarness()
    try {
      const login = await harness.loginAsAdmin()

      // 1. 创建一篇测试笔记
      const noteRes = await harness.request(
        '/api/notes',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: '公开分享的笔记',
            content: '# 标题\n\n这是一篇公开分享给所有人阅读的笔记。',
            format: 'markdown'
          })
        },
        login.cookie
      )
      expect(noteRes.status).toBe(201)
      const { note } = (await noteRes.json()) as { note: { id: string } }

      // 2. 初始时该笔记无分享配置
      const initialShareRes = await harness.request(`/api/notes/${note.id}/share`, {}, login.cookie)
      expect(initialShareRes.status).toBe(200)
      const initialShareBody = (await initialShareRes.json()) as { ok: boolean; share: unknown }
      expect(initialShareBody.share).toBeNull()

      // 3. 创建永久免密分享
      const createShareRes = await harness.request(
        `/api/notes/${note.id}/share`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            isEnabled: true,
            duration: 'permanent',
            hasPassword: false
          })
        },
        login.cookie
      )
      expect(createShareRes.status).toBe(201)
      const createBody = (await createShareRes.json()) as {
        ok: boolean
        share: {
          id: string
          shareCode: string
          isEnabled: boolean
          hasPassword: boolean
          expiresAt: number | null
          viewCount: number
        }
      }
      expect(createBody.ok).toBe(true)
      expect(createBody.share.isEnabled).toBe(true)
      expect(createBody.share.hasPassword).toBe(false)
      expect(createBody.share.expiresAt).toBeNull()
      const shareCode = createBody.share.shareCode
      expect(shareCode).toHaveLength(10)

      // 4. 外部访客（不带任何 cookie）直接访问该公开笔记
      const publicRes = await harness.request(`/api/share/${shareCode}`)
      expect(publicRes.status).toBe(200)
      const publicBody = (await publicRes.json()) as {
        ok: boolean
        requirePassword: boolean
        note: {
          title: string
          content: string
          format: string
          authorName: string
        }
      }
      expect(publicBody.ok).toBe(true)
      expect(publicBody.requirePassword).toBe(false)
      expect(publicBody.note.title).toBe('公开分享的笔记')
      expect(publicBody.note.content).toContain('这是一篇公开分享给所有人阅读的笔记')
      expect(publicBody.note.format).toBe('markdown')
      expect(publicBody.note.authorName).toBe('admin')

      // 5. 校验访问次数是否累加
      const shareAfterView = await harness.request(`/api/notes/${note.id}/share`, {}, login.cookie)
      const { share: shareRecord } = (await shareAfterView.json()) as {
        share: { viewCount: number }
      }
      expect(shareRecord.viewCount).toBe(1)
    } finally {
      harness.db.close()
    }
  })

  it('应支持设置访问密码与自定义过期时间，验证密码错误拒绝访问，过期后返回 410', async () => {
    const harness = createTestHarness()
    try {
      const login = await harness.loginAsAdmin()

      const noteRes = await harness.request(
        '/api/notes',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: '密码保护笔记',
            content: '<p>绝密内容不可直接阅读</p>',
            format: 'plain'
          })
        },
        login.cookie
      )
      const { note } = (await noteRes.json()) as { note: { id: string } }

      // 1. 设置密码为 123456，且设置 1 小时过期
      const setShareRes = await harness.request(
        `/api/notes/${note.id}/share`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            isEnabled: true,
            duration: '1h',
            hasPassword: true,
            password: 'SecretPassword99'
          })
        },
        login.cookie
      )
      expect(setShareRes.status).toBe(201)
      const { share } = (await setShareRes.json()) as {
        share: { shareCode: string; hasPassword: boolean; expiresAt: number }
      }
      expect(share.hasPassword).toBe(true)
      expect(share.expiresAt).toBeGreaterThan(Date.now())

      // 2. 外部访客不带密码访问：应返回 requirePassword: true 且不泄露正文
      const publicNoPwd = await harness.request(`/api/share/${share.shareCode}`)
      expect(publicNoPwd.status).toBe(200)
      const bodyNoPwd = (await publicNoPwd.json()) as {
        requirePassword: boolean
        note: { title: string; content?: string }
      }
      expect(bodyNoPwd.requirePassword).toBe(true)
      expect(bodyNoPwd.note.title).toBe('密码保护笔记')
      expect(bodyNoPwd.note.content).toBeUndefined()

      // 3. 提交错误密码访问：401
      const wrongPwdRes = await harness.request(`/api/share/${share.shareCode}/access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'WrongPassword' })
      })
      expect(wrongPwdRes.status).toBe(401)

      // 4. 提交正确密码访问：成功返回正文
      const correctPwdRes = await harness.request(`/api/share/${share.shareCode}/access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'SecretPassword99' })
      })
      expect(correctPwdRes.status).toBe(200)
      const correctBody = (await correctPwdRes.json()) as {
        ok: boolean
        note: { content: string; format: string }
      }
      expect(correctBody.note.content).toBe('<p>绝密内容不可直接阅读</p>')
      expect(correctBody.note.format).toBe('plain')

      // 5. 将数据库过期时间手动模拟为过去时间戳，验证过期访问返回 410
      await harness.db.sqlite
        .prepare(`UPDATE note_shares SET expires_at = ? WHERE share_code = ?`)
        .run(Date.now() - 1000, share.shareCode)

      const expiredRes = await harness.request(`/api/share/${share.shareCode}`)
      expect(expiredRes.status).toBe(410)

      // 6. 取消分享后访问返回 404
      const deleteShareRes = await harness.request(
        `/api/notes/${note.id}/share`,
        { method: 'DELETE' },
        login.cookie
      )
      expect(deleteShareRes.status).toBe(200)

      const afterDeleteRes = await harness.request(`/api/share/${share.shareCode}`)
      expect(afterDeleteRes.status).toBe(404)
    } finally {
      harness.db.close()
    }
  })

  it('外部访客应能够正常查看处于已开启分享状态笔记关联的 R2 图片，而私密笔记图片依然禁止公开访问', async () => {
    const harness = createTestHarness()
    try {
      const login = await harness.loginAsAdmin()

      // 1. 创建笔记并上传图片关联到该笔记
      const noteRes = await harness.request(
        '/api/notes',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: '带图分享笔记', content: '含图正文' })
        },
        login.cookie
      )
      const { note } = (await noteRes.json()) as { note: { id: string } }

      // 模拟上传图片
      const formData = new FormData()
      const fakeImage = new File(['fake-png-binary-data'], 'sample.png', { type: 'image/png' })
      formData.append('file', fakeImage)
      formData.append('noteId', note.id)

      const uploadRes = await harness.request(
        '/api/files/upload',
        {
          method: 'POST',
          body: formData
        },
        login.cookie
      )
      expect(uploadRes.status).toBe(201)
      const { attachment } = (await uploadRes.json()) as { attachment: { id: string } }

      // 2. 在笔记未分享时，外部未登录访客直接请求该图片地址：应被 401 拒绝（未登录）
      const unsharedFileRes = await harness.request(`/api/files/${attachment.id}`)
      expect(unsharedFileRes.status).toBe(401)

      // 3. 开启笔记公开分享
      const shareRes = await harness.request(
        `/api/notes/${note.id}/share`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isEnabled: true, duration: 'permanent', hasPassword: false })
        },
        login.cookie
      )
      expect(shareRes.status).toBe(201)

      // 4. 笔记处于公开分享中时，外部未登录访客再次请求图片：应正常放行返回 200
      const sharedFileRes = await harness.request(`/api/files/${attachment.id}`)
      expect(sharedFileRes.status).toBe(200)
      expect(sharedFileRes.headers.get('content-type')).toBe('image/png')
    } finally {
      harness.db.close()
    }
  })
})
