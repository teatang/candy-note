import enElLocale from 'element-plus/es/locale/lang/en'
import zhCnElLocale from 'element-plus/es/locale/lang/zh-cn'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { getInitialLocale, i18n, persistLocale } from '@/i18n'
import type { LocaleCode } from '@/types'

/**
 * 全局国际化语言状态仓库
 * 支持简体中文 (zh-CN，默认) 与英文 (en-US) 切换，并同步 Element Plus 组件语言包
 */
export const useLocaleStore = defineStore('locale', () => {
  const locale = ref<LocaleCode>(getInitialLocale())

  /** 当前语言对应的 Element Plus 语言包 */
  const elementLocale = computed(() =>
    locale.value === 'en-US' ? enElLocale : zhCnElLocale
  )

  /** 切换当前语言并同步 html[lang]、vue-i18n 与本地存储 */
  function setLocale(nextLocale: LocaleCode) {
    locale.value = nextLocale
    i18n.global.locale.value = nextLocale
    persistLocale(nextLocale)
    if (typeof document !== 'undefined') {
      document.documentElement.lang = nextLocale
    }
  }

  /** 中英文快捷互切 */
  function toggleLocale() {
    setLocale(locale.value === 'zh-CN' ? 'en-US' : 'zh-CN')
  }

  return {
    locale,
    elementLocale,
    setLocale,
    toggleLocale
  }
})
