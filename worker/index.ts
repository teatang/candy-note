import { Hono } from 'hono'
import { cleanupExpiredData } from './db/repository'
import { adminRoutes } from './routes/admin'
import { authRoutes } from './routes/auth'
import { fileRoutes } from './routes/files'
import { folderRoutes } from './routes/folders'
import { noteRoutes } from './routes/notes'
import type { AppEnv, Env } from './types'
import { apiError } from './types'

/**
 * 构造糖果笔记 (Candy Note) 主 Hono 应用实例
 * 导出 createApp 方便 Vitest 单元测试与 Cloudflare Worker 复用
 */
export function createApp() {
  const app = new Hono<AppEnv>()

  // 全局异常兜底处理
  app.onError((err, c) => {
    console.error('[CandyNote Worker Error]', err)
    return apiError(c, 500, 'INTERNAL_ERROR', '服务器内部错误，请稍后重试')
  })

  // 健康检查接口
  app.get('/api/health', (c) => {
    return c.json({ ok: true, service: 'candy-note', timestamp: Date.now() })
  })

  // 注册业务 API 路由
  app.route('/api/auth', authRoutes)
  app.route('/api/folders', folderRoutes)
  app.route('/api/notes', noteRoutes)
  app.route('/api/files', fileRoutes)
  app.route('/api/admin', adminRoutes)

  // 未匹配的 /api/* 请求返回 JSON 404
  app.all('/api/*', (c) => {
    return c.json({ ok: false, code: 'NOT_FOUND', message: '接口路径不存在' }, 404)
  })

  // 非 API 请求交由 Cloudflare Workers Static Assets 静态资源与 SPA 路由回退处理
  app.all('*', async (c) => {
    if (c.env.ASSETS) {
      return c.env.ASSETS.fetch(c.req.raw)
    }
    return c.text('Candy Note Worker API is running', 200)
  })

  return app
}

const app = createApp()

/**
 * Cloudflare Worker 默认导出入口
 * - fetch: 处理 HTTP API 与静态资源请求
 * - scheduled: 定时清理过期验证码、过期会话及超过 7 天的笔记历史版本
 */
export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(cleanupExpiredData(env.DB))
  }
}
