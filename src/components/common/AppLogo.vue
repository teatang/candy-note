<script setup lang="ts">
import { useI18n } from 'vue-i18n'

/**
 * 糖果笔记 (Candy Note) 极简品牌 Logo 组件
 */
defineProps<{
  compact?: boolean
}>()

const { t } = useI18n()
</script>

<template>
  <div class="inline-flex items-center gap-2.5 select-none">
    <div
      class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-rose-500 via-pink-500 to-amber-400 shadow-sm shadow-rose-500/20"
    >
      <svg class="h-4.5 w-4.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M7 7h10M7 12h10M7 17h6" />
        <circle cx="17.5" cy="17" r="2" fill="currentColor" stroke="none" />
      </svg>
    </div>
    <div v-if="!compact" class="flex flex-col leading-tight">
      <span class="text-sm font-semibold tracking-tight text-slate-900 dark:text-slate-100">
        {{ t('brand.name') }}
      </span>
      <span class="text-[11px] text-slate-400 dark:text-slate-500">Candy Note</span>
    </div>
  </div>
</template>
