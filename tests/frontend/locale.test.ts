import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { i18n } from '@/i18n'
import { useLocaleStore } from '@/stores/locale'

/**
 * i18n 中英文国际化切换单元测试
 */
describe('Locale & i18n Store', () => {
  beforeEach(() => {
    localStorage.clear()
    i18n.global.locale.value = 'zh-CN'
    setActivePinia(createPinia())
  })

  it('默认语言应为简体中文 (zh-CN)，支持切换英文 (en-US) 并同步文档与 Element Plus 语言包', () => {
    const store = useLocaleStore()
    expect(store.locale).toBe('zh-CN')
    expect(i18n.global.t('brand.name')).toBe('糖果笔记')
    expect(store.elementLocale.name).toBe('zh-cn')

    store.setLocale('en-US')
    expect(store.locale).toBe('en-US')
    expect(i18n.global.locale.value).toBe('en-US')
    expect(i18n.global.t('brand.name')).toBe('Candy Note')
    expect(store.elementLocale.name).toBe('en')
    expect(localStorage.getItem('candy_note_locale')).toBe('en-US')
    expect(document.documentElement.lang).toBe('en-US')

    store.toggleLocale()
    expect(store.locale).toBe('zh-CN')
    expect(i18n.global.t('brand.name')).toBe('糖果笔记')
  })
})
