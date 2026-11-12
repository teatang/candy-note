import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useThemeStore } from '@/stores/theme'

/**
 * 日夜模式与跟随系统主题 Store 单元测试
 */
describe('Theme Store', () => {
  let listeners: Array<(e: MediaQueryListEvent) => void> = []
  let mockMatches = false

  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
    listeners = []
    mockMatches = false

    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation(() => ({
        matches: mockMatches,
        media: '(prefers-color-scheme: dark)',
        addEventListener: (_event: string, cb: (e: MediaQueryListEvent) => void) => {
          listeners.push(cb)
        },
        removeEventListener: vi.fn()
      }))
    )

    setActivePinia(createPinia())
  })

  it('默认应跟随系统，支持手动切换日夜模式并持久化到 localStorage', () => {
    const store = useThemeStore()
    store.initTheme()

    expect(store.mode).toBe('system')
    expect(store.isDark).toBe(false)
    expect(document.documentElement.classList.contains('dark')).toBe(false)

    store.setMode('dark')
    expect(store.isDark).toBe(true)
    expect(localStorage.getItem('candy_note_theme')).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    store.setMode('light')
    expect(store.isDark).toBe(false)
    expect(localStorage.getItem('candy_note_theme')).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('在跟随系统模式下，应实时响应操作系统暗黑模式变更事件', () => {
    const store = useThemeStore()
    store.initTheme()
    expect(store.isDark).toBe(false)

    for (const cb of listeners) {
      cb({ matches: true } as MediaQueryListEvent)
    }
    expect(store.isDark).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    for (const cb of listeners) {
      cb({ matches: false } as MediaQueryListEvent)
    }
    expect(store.isDark).toBe(false)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
})
