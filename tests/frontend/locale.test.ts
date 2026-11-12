import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { i18n } from '@/i18n'
import enUS from '@/i18n/en-US'
import zhCN from '@/i18n/zh-CN'
import { useLocaleStore } from '@/stores/locale'

/**
 * 递归收集国际化消息对象中的所有叶子键路径，确保每条文案都可安全编译
 */
function collectMessageKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = []
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...collectMessageKeys(v as Record<string, unknown>, path))
    } else {
      keys.push(path)
    }
  }
  return keys
}

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

  it('中英文全部国际化文案均可正常编译且管理员添加用户表单中的 @ 符号转义正确', () => {
    const store = useLocaleStore()
    const zhKeys = collectMessageKeys(zhCN as unknown as Record<string, unknown>)
    const enKeys = collectMessageKeys(enUS as unknown as Record<string, unknown>)
    expect(zhKeys).toEqual(enKeys)

    for (const locale of ['zh-CN', 'en-US'] as const) {
      store.setLocale(locale)
      for (const key of zhKeys) {
        expect(() => i18n.global.t(key)).not.toThrow()
      }
    }

    store.setLocale('zh-CN')
    expect(i18n.global.t('admin.form.usernamePlaceholder')).toBe('2-32位字符，不可包含 @ 或空格')
    expect(i18n.global.t('admin.form.emailPlaceholder')).toBe('name@example.com')

    store.setLocale('en-US')
    expect(i18n.global.t('admin.form.usernamePlaceholder')).toBe('2-32 chars, no @ or whitespace')
    expect(i18n.global.t('admin.form.emailPlaceholder')).toBe('name@example.com')
  })
})
