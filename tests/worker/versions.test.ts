import { describe, expect, it } from 'vitest'
import { SEVEN_DAYS_MS } from '@worker/utils/validation'
import { createTestHarness } from '../helpers/testApp'

/**
 * 笔记一周（7天）内历史版本与回退单元测试
 */
describe('Note Version History (7-Day Rollback) API', () => {
  it('支持保存历史快照、回退版本并保留回退前安全备份', async () => {
    const harness = createTestHarness()
    try {
      const admin = await harness.loginAsAdmin()

      // 创建笔记（自动产生 v1）
      const createRes = await harness.request(
        '/api/notes',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: '初稿标题',
            content: '第一版内容',
            format: 'markdown'
          })
        },
        admin.cookie
      )
      const { note } = (await createRes.json()) as { note: { id: string } }

      // 手动保存第二版（产生 v2）
      await harness.request(
        `/api/notes/${note.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: '终稿标题',
            content: '第二版最新内容',
            changeType: 'save'
          })
        },
        admin.cookie
      )

      const versionsRes = await harness.request(`/api/notes/${note.id}/versions`, {}, admin.cookie)
      const { versions } = (await versionsRes.json()) as {
        versions: Array<{ id: string; versionNumber: number; title: string; content: string }>
      }
      expect(versions).toHaveLength(2)
      const v1 = versions.find((v) => v.versionNumber === 1)!
      expect(v1.title).toBe('初稿标题')

      // 回退到 v1
      const rollbackRes = await harness.request(
        `/api/notes/${note.id}/versions/${v1.id}/rollback`,
        { method: 'POST' },
        admin.cookie
      )
      expect(rollbackRes.status).toBe(200)
      const rollbackBody = (await rollbackRes.json()) as {
        note: { title: string; content: string }
      }
      expect(rollbackBody.note.title).toBe('初稿标题')
      expect(rollbackBody.note.content).toBe('第一版内容')

      // 确认系统在回退前额外备份了一个 before_rollback 快照（v3）
      const versionsAfter = await harness.request(`/api/notes/${note.id}/versions`, {}, admin.cookie)
      const bodyAfter = (await versionsAfter.json()) as {
        versions: Array<{ versionNumber: number; changeType: string; title: string }>
      }
      expect(bodyAfter.versions[0].changeType).toBe('before_rollback')
      expect(bodyAfter.versions[0].title).toBe('终稿标题')
    } finally {
      harness.db.close()
    }
  })

  it('超过一周（7 天）的历史版本应自动过滤清理并拒绝回退', async () => {
    const harness = createTestHarness()
    try {
      const admin = await harness.loginAsAdmin()
      const createRes = await harness.request(
        '/api/notes',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: '测试笔记', content: '当前内容', format: 'plain' })
        },
        admin.cookie
      )
      const { note } = (await createRes.json()) as { note: { id: string } }

      // 手动往数据库中插入一条 8 天前的历史版本记录
      const eightDaysAgo = Date.now() - SEVEN_DAYS_MS - 24 * 60 * 60 * 1000
      const expiredVersionId = 'expired-v-001'
      const userId = (admin.body.user as { id: string }).id
      harness.db.sqlite
        .prepare(
          `INSERT INTO note_versions (id, note_id, user_id, title, content, format, folder_id, version_number, change_type, created_at)
           VALUES (?, ?, ?, '过期标题', '过期内容', 'plain', NULL, 99, 'save', ?)`
        )
        .run(expiredVersionId, note.id, userId, eightDaysAgo)

      // 尝试回退该过期版本应返回 400 VERSION_EXPIRED
      const rollbackRes = await harness.request(
        `/api/notes/${note.id}/versions/${expiredVersionId}/rollback`,
        { method: 'POST' },
        admin.cookie
      )
      expect(rollbackRes.status).toBe(400)
      const errBody = (await rollbackRes.json()) as { code: string }
      expect(errBody.code).toBe('VERSION_EXPIRED')

      // 获取版本列表时仅包含 7 天内版本
      const listRes = await harness.request(`/api/notes/${note.id}/versions`, {}, admin.cookie)
      const { versions } = (await listRes.json()) as {
        versions: Array<{ id: string }>
      }
      expect(versions.some((v) => v.id === expiredVersionId)).toBe(false)
    } finally {
      harness.db.close()
    }
  })
})
