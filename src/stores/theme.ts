import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { ThemeMode } from '@/types'

const THEME_STORAGE_KEY = 'candy_note_theme'

/**
 * 读取本地持久化的主题偏好，默认跟随系统 (system)
 */
function readSavedTheme(): ThemeMode {
  if (typeof window !== 'undefined' && window.localStorage) {
    const val = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (val === 'light' || val === 'dark' || val === 'system') {
      return val
    }
  }
  return 'system'
}

/**
 * 检测操作系统当前是否为暗黑模式
 */
function detectSystemDark(): boolean {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  }
  return false
}

/**
 * 全局外观主题状态仓库
 * 支持日间模式 (light)、夜间模式 (dark) 与跟随系统 (system)
 */
export const useThemeStore = defineStore('theme', () => {
  const mode = ref<ThemeMode>(readSavedTheme())
  const systemPrefersDark = ref<boolean>(detectSystemDark())
  let mediaListenerAttached = false

  /** 当前最终是否生效暗黑模式 */
  const isDark = computed(() => {
    if (mode.value === 'dark') return true
    if (mode.value === 'light') return false
    return systemPrefersDark.value
  })

  /** 将暗黑模式类名同步到 <html> 元素，同时驱动 Tailwind dark: 与 Element Plus 暗黑变量 */
  function applyToDom() {
    if (typeof document === 'undefined') return
    document.documentElement.classList.toggle('dark', isDark.value)
  }

  /** 初始化主题并监听系统配色变更事件 */
  function initTheme() {
    systemPrefersDark.value = detectSystemDark()
    applyToDom()

    if (
      !mediaListenerAttached &&
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function'
    ) {
      const mql = window.matchMedia('(prefers-color-scheme: dark)')
      const onChange = (e: MediaQueryListEvent) => {
        systemPrefersDark.value = e.matches
        applyToDom()
      }
      if (typeof mql.addEventListener === 'function') {
        mql.addEventListener('change', onChange)
      }
      mediaListenerAttached = true
    }
  }

  /** 切换主题模式并持久化 */
  function setMode(nextMode: ThemeMode) {
    mode.value = nextMode
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextMode)
    }
    applyToDom()
  }

  return {
    mode,
    systemPrefersDark,
    isDark,
    initTheme,
    setMode,
    applyToDom
  }
})
