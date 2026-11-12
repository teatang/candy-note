import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

/**
 * 基于 Node 22 内置 node:sqlite 实现的高保真 Cloudflare D1 模拟适配器
 * 直接加载项目真实的 migrations/0001_init.sql 建表脚本，用于执行真实 SQL 单元测试
 */
class MockD1PreparedStatement {
  private readonly db: DatabaseSync
  private readonly sql: string
  private readonly params: SQLInputValue[]

  constructor(db: DatabaseSync, sql: string, params: SQLInputValue[] = []) {
    this.db = db
    this.sql = sql
    this.params = params
  }

  bind(...values: unknown[]): D1PreparedStatement {
    const normalized = values.map((v) => {
      if (v === undefined) return null
      if (typeof v === 'boolean') return v ? 1 : 0
      return v as SQLInputValue
    })
    return new MockD1PreparedStatement(this.db, this.sql, normalized) as unknown as D1PreparedStatement
  }

  async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
    const stmt = this.db.prepare(this.sql)
    const row = stmt.get(...this.params) as Record<string, unknown> | undefined
    if (!row) return null
    if (colName) {
      return (row[colName] as T) ?? null
    }
    return { ...row } as T
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const stmt = this.db.prepare(this.sql)
    const rows = stmt.all(...this.params) as Array<Record<string, unknown>>
    return {
      results: rows.map((r) => ({ ...r }) as T),
      success: true,
      meta: {
        duration: 0,
        size_after: 0,
        rows_read: rows.length,
        rows_written: 0,
        last_row_id: 0,
        changed_db: false,
        changes: 0
      }
    }
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const stmt = this.db.prepare(this.sql)
    const info = stmt.run(...this.params)
    return {
      results: [],
      success: true,
      meta: {
        duration: 0,
        size_after: 0,
        rows_read: 0,
        rows_written: Number(info.changes ?? 0),
        last_row_id: Number(info.lastInsertRowid ?? 0),
        changed_db: Number(info.changes ?? 0) > 0,
        changes: Number(info.changes ?? 0)
      }
    }
  }

  async raw<T = unknown[]>(): Promise<T[]> {
    const stmt = this.db.prepare(this.sql)
    const rows = stmt.all(...this.params) as Array<Record<string, unknown>>
    return rows.map((r) => Object.values(r) as T)
  }
}

export class MockD1Database {
  readonly sqlite: DatabaseSync

  constructor() {
    this.sqlite = new DatabaseSync(':memory:')
    this.sqlite.exec('PRAGMA foreign_keys = ON;')
    const migrationSql = readFileSync(
      resolve(process.cwd(), 'migrations/0001_init.sql'),
      'utf-8'
    )
    this.sqlite.exec(migrationSql)
  }

  prepare(query: string): D1PreparedStatement {
    return new MockD1PreparedStatement(this.sqlite, query) as unknown as D1PreparedStatement
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const results: D1Result<T>[] = []
    this.sqlite.exec('BEGIN IMMEDIATE')
    try {
      for (const stmt of statements) {
        results.push(await stmt.run<T>())
      }
      this.sqlite.exec('COMMIT')
      return results
    } catch (err) {
      this.sqlite.exec('ROLLBACK')
      throw err
    }
  }

  async exec(query: string): Promise<D1ExecResult> {
    this.sqlite.exec(query)
    return { count: 1, duration: 0 }
  }

  close() {
    this.sqlite.close()
  }
}
