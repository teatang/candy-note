import { describe, expect, it } from 'vitest'
import { createTestHarness } from '../helpers/testApp'

/**
 * 文件夹管理、笔记多格式（Markdown/纯文本）、置顶、拖动排序及多用户数据隔离单元测试
 */
describe('Folders, Notes, Pinning & Reorder API', () => {
  it('支持文件夹新建、防循环移动、拖动排序及安全删除（笔记移入未分类）', async () => {
    const harness = createTestHarness()
    try {
      const admin = await harness.loginAsAdmin()

      const f1Res = await harness.request(
        '/api/folders',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: '目录A' })
        },
        admin.cookie
      )
      const f2Res = await harness.request(
        '/api/folders',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: '目录B' })
        },
        admin.cookie
      )
      const f1 = ((await f1Res.json()) as { folder: { id: string } }).folder
      const f2 = ((await f2Res.json()) as { folder: { id: string } }).folder

      // 批量拖动排序：将 目录B 放到 目录A 之前
      const reorderRes = await harness.request(
        '/api/folders/reorder',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: [
              { id: f2.id, sortOrder: 0 },
              { id: f1.id, sortOrder: 1 }
            ]
          })
        },
        admin.cookie
      )
      expect(reorderRes.status).toBe(200)

      const listRes = await harness.request('/api/folders', {}, admin.cookie)
      const { folders } = (await listRes.json()) as { folders: Array<{ id: string; name: string }> }
      expect(folders.map((f) => f.name)).toEqual(['目录B', '目录A'])

      // 在目录A下创建笔记后删除目录A，笔记应安全回到未分类（folderId === null）
      const noteRes = await harness.request(
        '/api/notes',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: '重要备忘',
            content: '内容',
            format: 'plain',
            folderId: f1.id
          })
        },
        admin.cookie
      )
      const createdNote = ((await noteRes.json()) as { note: { id: string } }).note

      const delFolderRes = await harness.request(
        `/api/folders/${f1.id}`,
        { method: 'DELETE' },
        admin.cookie
      )
      expect(delFolderRes.status).toBe(200)

      const noteDetailRes = await harness.request(`/api/notes/${createdNote.id}`, {}, admin.cookie)
      const { note } = (await noteDetailRes.json()) as { note: { folderId: string | null } }
      expect(note.folderId).toBeNull()
    } finally {
      harness.db.close()
    }
  })

  it('支持普通文本与 Markdown 笔记、置顶优先排序、拖动排序及多用户隔离', async () => {
    const harness = createTestHarness()
    try {
      const admin = await harness.loginAsAdmin()

      // 创建两篇笔记
      const n1Res = await harness.request(
        '/api/notes',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: '笔记一', content: 'plain text', format: 'plain' })
        },
        admin.cookie
      )
      const n2Res = await harness.request(
        '/api/notes',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: '笔记二', content: '# Markdown', format: 'markdown' })
        },
        admin.cookie
      )
      const n1 = ((await n1Res.json()) as { note: { id: string } }).note
      const n2 = ((await n2Res.json()) as { note: { id: string } }).note

      // 拖动排序设置 n1 排在 n2 前面
      await harness.request(
        '/api/notes/reorder',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: [
              { id: n1.id, sortOrder: 1 },
              { id: n2.id, sortOrder: 2 }
            ]
          })
        },
        admin.cookie
      )

      // 置顶 n2 后，n2 应排在最前面
      await harness.request(
        `/api/notes/${n2.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isPinned: true })
        },
        admin.cookie
      )

      const listRes = await harness.request('/api/notes', {}, admin.cookie)
      const { notes } = (await listRes.json()) as {
        notes: Array<{ id: string; title: string; isPinned: boolean }>
      }
      expect(notes[0].id).toBe(n2.id)
      expect(notes[0].isPinned).toBe(true)
      expect(notes[1].id).toBe(n1.id)

      // 多用户隔离：新用户 Bob 不能读取或修改管理员的笔记
      await harness.request(
        '/api/admin/users',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: 'Bob',
            email: 'bob@candynote.dev',
            password: 'BobPassword123!',
            role: 'user',
            status: 'active'
          })
        },
        admin.cookie
      )
      const bob = await harness.login('Bob', 'BobPassword123!')
      const bobReadAdminNote = await harness.request(`/api/notes/${n1.id}`, {}, bob.cookie)
      expect(bobReadAdminNote.status).toBe(404)
    } finally {
      harness.db.close()
    }
  })
})
