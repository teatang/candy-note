import { describe, expect, it } from 'vitest'
import { createTestHarness } from '../helpers/testApp'

/**
 * 管理后台统计概览与手动用户管理单元测试
 */
describe('Admin Console & User Management API', () => {
  it('普通用户无权访问管理后台接口', async () => {
    const harness = createTestHarness()
    try {
      const admin = await harness.loginAsAdmin()
      await harness.request(
        '/api/admin/users',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: 'NormalUser',
            email: 'normal@candynote.dev',
            password: 'Password123!',
            role: 'user',
            status: 'active'
          })
        },
        admin.cookie
      )

      const userLogin = await harness.login('NormalUser', 'Password123!')
      const statsRes = await harness.request('/api/admin/stats', {}, userLogin.cookie)
      expect(statsRes.status).toBe(403)
    } finally {
      harness.db.close()
    }
  })

  it('管理员可查看完整平台统计概览并手动增删改用户、同步清理 R2 图片', async () => {
    const harness = createTestHarness()
    try {
      const admin = await harness.loginAsAdmin()

      // 创建普通用户
      const createRes = await harness.request(
        '/api/admin/users',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: 'Alice',
            email: 'alice@candynote.dev',
            password: 'AlicePass123!',
            role: 'user',
            status: 'active'
          })
        },
        admin.cookie
      )
      expect(createRes.status).toBe(201)
      const createdUser = ((await createRes.json()) as { user: { id: string } }).user

      // 重复邮箱或昵称应返回 409 冲突
      const dupRes = await harness.request(
        '/api/admin/users',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: 'Alice2',
            email: 'alice@candynote.dev',
            password: 'AlicePass123!',
            role: 'user',
            status: 'active'
          })
        },
        admin.cookie
      )
      expect(dupRes.status).toBe(409)

      // Alice 登录并创建文件夹、Markdown 笔记、上传图片到 R2
      const aliceLogin = await harness.login('Alice', 'AlicePass123!')
      await harness.request(
        '/api/folders',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: '工作记录' })
        },
        aliceLogin.cookie
      )
      await harness.request(
        '/api/notes',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'Alice MD',
            content: '# Hello',
            format: 'markdown',
            isPinned: true
          })
        },
        aliceLogin.cookie
      )

      const form = new FormData()
      form.append('file', new File([new Uint8Array([1, 2, 3, 4])], 'pic.png', { type: 'image/png' }))
      await harness.request(
        '/api/files/upload',
        { method: 'POST', body: form },
        aliceLogin.cookie
      )
      expect(harness.r2.store.size).toBe(1)

      // 查看后台概览统计
      const statsRes = await harness.request('/api/admin/stats', {}, admin.cookie)
      expect(statsRes.status).toBe(200)
      const { stats } = (await statsRes.json()) as {
        stats: {
          users: { total: number; active: number }
          notes: { total: number; markdown: number; pinned: number }
          folders: { total: number }
          attachments: { totalCount: number; totalSizeBytes: number }
        }
      }
      expect(stats.users.total).toBe(2)
      expect(stats.notes.total).toBe(1)
      expect(stats.notes.markdown).toBe(1)
      expect(stats.notes.pinned).toBe(1)
      expect(stats.folders.total).toBe(1)
      expect(stats.attachments.totalCount).toBe(1)
      expect(stats.attachments.totalSizeBytes).toBe(4)

      // 管理员重设 Alice 密码后可用新密码登录
      const resetRes = await harness.request(
        `/api/admin/users/${createdUser.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: 'NewAlicePassword999!' })
        },
        admin.cookie
      )
      expect(resetRes.status).toBe(200)
      const relogin = await harness.login('Alice', 'NewAlicePassword999!')
      expect(relogin.response.status).toBe(200)

      // 删除 Alice 后应连同清理 R2 存储中的图片
      const deleteRes = await harness.request(
        `/api/admin/users/${createdUser.id}`,
        { method: 'DELETE' },
        admin.cookie
      )
      expect(deleteRes.status).toBe(200)
      expect(harness.r2.store.size).toBe(0)
    } finally {
      harness.db.close()
    }
  })

  it('禁止管理员删除或禁用当前自身账号', async () => {
    const harness = createTestHarness()
    try {
      const admin = await harness.loginAsAdmin()
      const adminUser = admin.body.user as { id: string }

      const selfDisable = await harness.request(
        `/api/admin/users/${adminUser.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'disabled' })
        },
        admin.cookie
      )
      expect(selfDisable.status).toBe(400)

      const selfDelete = await harness.request(
        `/api/admin/users/${adminUser.id}`,
        { method: 'DELETE' },
        admin.cookie
      )
      expect(selfDelete.status).toBe(400)
    } finally {
      harness.db.close()
    }
  })
})
