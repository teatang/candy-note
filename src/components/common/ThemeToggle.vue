<script setup lang="ts">
import { Monitor, Moon, Sunny } from '@element-plus/icons-vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'
import type { ThemeMode } from '@/types'

/**
 * 日夜模式与跟随系统外观切换组件
 */
const { t } = useI18n()
const themeStore = useThemeStore()

const options = computed<Array<{ value: ThemeMode; label: string }>>(() => [
  { value: 'light', label: t('theme.light') },
  { value: 'dark', label: t('theme.dark') },
  { value: 'system', label: t('theme.system') }
])
</script>

<template>
  <el-dropdown trigger="click" @command="(val: ThemeMode) => themeStore.setMode(val)">
    <el-button
      size="small"
      class="!rounded-lg !border-slate-200 dark:!border-slate-700 !bg-white dark:!bg-slate-800"
      :aria-label="t('theme.label')"
    >
      <el-icon class="mr-1">
        <Sunny v-if="themeStore.mode === 'light'" />
        <Moon v-else-if="themeStore.mode === 'dark'" />
        <Monitor v-else />
      </el-icon>
      <span class="hidden sm:inline text-xs">
        {{
          themeStore.mode === 'light'
            ? t('theme.light')
            : themeStore.mode === 'dark'
              ? t('theme.dark')
              : t('theme.system')
        }}
      </span>
    </el-button>
    <template #dropdown>
      <el-dropdown-menu>
        <el-dropdown-item
          v-for="item in options"
          :key="item.value"
          :command="item.value"
          :class="{ '!text-rose-500 font-medium': themeStore.mode === item.value }"
        >
          <el-icon>
            <Sunny v-if="item.value === 'light'" />
            <Moon v-else-if="item.value === 'dark'" />
            <Monitor v-else />
          </el-icon>
          <span>{{ item.label }}</span>
        </el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>
