import { createI18n } from 'vue-i18n'
import type { LocaleCode } from '@/types'
import enUS from './en-US'
import zhCN from './zh-CN'

const LOCALE_STORAGE_KEY = 'candy_note_locale'

/**
 * 读取本地持久化的语言设置，默认返回简体中文 (zh-CN)
 */
export function getInitialLocale(): LocaleCode {
  if (typeof window !== 'undefined' && window.localStorage) {
    const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY)
    if (saved === 'en-US' || saved === 'zh-CN') {
      return saved
    }
  }
  return 'zh-CN'
}

/**
 * 保存语言设置到 localStorage
 */
export function persistLocale(locale: LocaleCode): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  }
}

/**
 * 创建全局 vue-i18n 实例（支持中文 zh-CN 与英文 en-US 切换，默认中文）
 */
export function createAppI18n(initialLocale: LocaleCode = getInitialLocale()) {
  return createI18n({
    legacy: false,
    locale: initialLocale,
    fallbackLocale: 'zh-CN',
    messages: {
      'zh-CN': zhCN,
      'en-US': enUS
    }
  })
}

export const i18n = createAppI18n()
