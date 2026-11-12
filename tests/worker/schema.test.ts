import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanupExpiredData } from '@worker/db/repository'
import { isNoSuchTableError, SCHEMA_STATEMENTS } from '@worker/db/schema'
import { describe, expect, it } from 'vitest'
import { createTestHarness } from '../helpers/testApp'

/**
 * 数据库空白环境自动建表与异常自愈单元测试
 * 模拟尚未执行 d1 migrations 的测试/本地开发库，验证 Worker 不会抛出 no such table: users 500 错误
 */
describe('Database Auto-Bootstrap Schema', () => {
  it('空白未迁移数据库中并发请求 /api/auth/me 与 /api/auth/captcha 应自动建表并正常响应', async () => {
    const harness = createTestHarness({}, { skipMigration: true })
    try {
      // 确认初始数据库为空白（没有任何业务表）
      const initialTables = harness.db.sqlite
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
        .all() as Array<{ name: string }>
      expect(initialTables).toHaveLength(0)

      // 并发触发首屏请求：检查登录态 (/api/auth/me) + 获取验证码 (/api/auth/captcha)
      const [meRes, captchaRes] = await Promise.all([
        harness.request('/api/auth/me'),
        harness.request('/api/auth/captcha')
      ])

      expect(meRes.status).toBe(401)
      expect(captchaRes.status).toBe(200)
      const captchaBody = (await captchaRes.json()) as { ok: boolean; image: string }
      expect(captchaBody.ok).toBe(true)
      expect(captchaBody.image).toMatch(/^data:image\/svg\+xml;base64,/)

      // 自动建表并初始化管理员后，应可正常登录并读写文件夹/笔记/历史版本
      const login = await harness.loginAsAdmin()
      expect(login.response.status).toBe(200)

      const folderRes = await harness.request(
        '/api/folders',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: '自动建表验证目录' })
        },
        login.cookie
      )
      expect(folderRes.status).toBe(201)

      const noteRes = await harness.request(
        '/api/notes',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: '测试笔记', content: 'Hello Candy Note', format: 'markdown' })
        },
        login.cookie
      )
      expect(noteRes.status).toBe(201)
    } finally {
      harness.db.close()
    }
  })

  it('空白数据库中调用退出登录 (/api/auth/logout) 与定时清理任务也应安全兜底建表不报错', async () => {
    const harness = createTestHarness({}, { skipMigration: true })
    try {
      const logoutRes = await harness.request(
        '/api/auth/logout',
        { method: 'POST' },
        'candy_note_session=stale-token'
      )
      expect(logoutRes.status).toBe(200)

      const harnessCron = createTestHarness({}, { skipMigration: true })
      try {
        await expect(cleanupExpiredData(harnessCron.env.DB)).resolves.toBeUndefined()
        const tables = harnessCron.db.sqlite
          .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
          .all() as Array<{ name: string }>
        expect(tables.map((t) => t.name)).toEqual([
          'attachments',
          'captchas',
          'folders',
          'note_versions',
          'notes',
          'sessions',
          'users'
        ])
      } finally {
        harnessCron.db.close()
      }
    } finally {
      harness.db.close()
    }
  })

  it('isNoSuchTableError 应准确识别 D1_ERROR 包装异常，且内嵌建表语句应覆盖 0001_init.sql 全部表和索引', () => {
    const cause = new Error('no such table: users: SQLITE_ERROR')
    const wrapped = new Error('D1_ERROR: no such table: users: SQLITE_ERROR', { cause })
    expect(isNoSuchTableError(wrapped)).toBe(true)
    expect(isNoSuchTableError(new Error('UNIQUE constraint failed'))).toBe(false)

    const migrationSql = readFileSync(resolve(process.cwd(), 'migrations/0001_init.sql'), 'utf8')
    const expectedTables = Array.from(
      migrationSql.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-z0-9_]+)/gi)
    ).map((m) => m[1])
    const expectedIndexes = Array.from(
      migrationSql.matchAll(/CREATE INDEX IF NOT EXISTS\s+([a-z0-9_]+)/gi)
    ).map((m) => m[1])

    const schemaSql = SCHEMA_STATEMENTS.join(';\n')
    for (const table of expectedTables) {
      expect(schemaSql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`)
    }
    for (const index of expectedIndexes) {
      expect(schemaSql).toContain(`CREATE INDEX IF NOT EXISTS ${index}`)
    }
  })
})
