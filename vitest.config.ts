import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

/**
 * Vitest 单元测试配置（使用 projects 隔离前后端运行环境）
 * - worker 项目：在 Node 环境下配合内置 node:sqlite 执行 Cloudflare Worker API 与业务单元测试
 * - frontend 项目：在 jsdom 环境下执行 Pinia 状态、工具函数及 Vue 组件单元测试
 */
export default defineConfig({
  test: {
    projects: [
      {
        resolve: {
          alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
            '@worker': fileURLToPath(new URL('./worker', import.meta.url))
          }
        },
        test: {
          name: 'worker',
          globals: true,
          environment: 'node',
          include: ['tests/worker/**/*.test.ts']
        }
      },
      {
        plugins: [vue()],
        resolve: {
          alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
            '@worker': fileURLToPath(new URL('./worker', import.meta.url))
          }
        },
        test: {
          name: 'frontend',
          globals: true,
          environment: 'jsdom',
          include: ['tests/frontend/**/*.test.ts']
        }
      }
    ]
  }
})
