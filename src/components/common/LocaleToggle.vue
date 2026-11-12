<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useLocaleStore } from '@/stores/locale'
import type { LocaleCode } from '@/types'

/**
 * 中英文多语言切换组件（默认简体中文）
 */
const { t } = useI18n()
const localeStore = useLocaleStore()
</script>

<template>
  <el-dropdown trigger="click" @command="(val: LocaleCode) => localeStore.setLocale(val)">
    <el-button
      size="small"
      class="!rounded-lg !border-slate-200 dark:!border-slate-700 !bg-white dark:!bg-slate-800"
      :aria-label="t('locale.label')"
    >
      <span class="text-xs font-medium">
        {{ localeStore.locale === 'zh-CN' ? '中文' : 'EN' }}
      </span>
    </el-button>
    <template #dropdown>
      <el-dropdown-menu>
        <el-dropdown-item
          command="zh-CN"
          :class="{ '!text-rose-500 font-medium': localeStore.locale === 'zh-CN' }"
        >
          {{ t('locale.zhCN') }}
        </el-dropdown-item>
        <el-dropdown-item
          command="en-US"
          :class="{ '!text-rose-500 font-medium': localeStore.locale === 'en-US' }"
        >
          {{ t('locale.enUS') }}
        </el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>
