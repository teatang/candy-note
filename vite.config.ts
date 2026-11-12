import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

/**
 * Vite 构建与开发服务器配置
 * - 集成 Vue 3 单文件组件支持
 * - 集成 Tailwind CSS v4 Vite 插件
 * - 本地开发时将 `/api` 请求代理到本地 Wrangler Worker (默认端口 8787)
 * - 配置合理的分包策略优化静态资源缓存性能
 */
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@worker': fileURLToPath(new URL('./worker', import.meta.url))
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'vue-vendor': ['vue', 'vue-router', 'pinia', 'vue-i18n'],
          'element-plus': ['element-plus', '@element-plus/icons-vue'],
          'markdown-vendor': ['marked', 'dompurify']
        }
      }
    }
  }
})
