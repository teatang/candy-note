<script setup lang="ts">
import { Document, Files, Folder, UserFilled } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import type { AdminStats } from '@/types'
import { formatBytes } from '@/utils/date'

/**
 * 管理后台核心指标概览卡片组件
 * 展示总用户数、笔记及格式分布、文件夹/7天版本数以及 R2 对象存储占用情况
 */
defineProps<{
  stats: AdminStats
}>()

const { t } = useI18n()
</script>

<template>
  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
    <div
      class="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-slate-900"
    >
      <div class="flex items-center justify-between">
        <span class="text-xs font-medium text-slate-500 dark:text-slate-400">
          {{ t('admin.stats.totalUsers') }}
        </span>
        <div class="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-50 text-rose-500 dark:bg-rose-500/15">
          <el-icon><UserFilled /></el-icon>
        </div>
      </div>
      <div class="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100">
        {{ stats.users.total }}
      </div>
      <div class="mt-1 text-xs text-slate-400">
        {{ t('admin.stats.activeUsers', { active: stats.users.active, disabled: stats.users.disabled }) }}
      </div>
    </div>

    <div
      class="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-slate-900"
    >
      <div class="flex items-center justify-between">
        <span class="text-xs font-medium text-slate-500 dark:text-slate-400">
          {{ t('admin.stats.totalNotes') }}
        </span>
        <div class="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-50 text-indigo-500 dark:bg-indigo-500/15">
          <el-icon><Document /></el-icon>
        </div>
      </div>
      <div class="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100">
        {{ stats.notes.total }}
      </div>
      <div class="mt-1 text-xs text-slate-400">
        {{
          t('admin.stats.notesBreakdown', {
            md: stats.notes.markdown,
            plain: stats.notes.plain,
            pinned: stats.notes.pinned
          })
        }}
      </div>
    </div>

    <div
      class="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-slate-900"
    >
      <div class="flex items-center justify-between">
        <span class="text-xs font-medium text-slate-500 dark:text-slate-400">
          {{ t('admin.stats.totalFolders') }}
        </span>
        <div class="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-50 text-amber-500 dark:bg-amber-500/15">
          <el-icon><Folder /></el-icon>
        </div>
      </div>
      <div class="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100">
        {{ stats.folders.total }}
      </div>
      <div class="mt-1 text-xs text-slate-400">
        {{ t('admin.stats.versions7d', { count: stats.versions.totalLast7Days }) }}
      </div>
    </div>

    <div
      class="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-slate-900"
    >
      <div class="flex items-center justify-between">
        <span class="text-xs font-medium text-slate-500 dark:text-slate-400">
          {{ t('admin.stats.r2Storage') }}
        </span>
        <div class="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-500 dark:bg-emerald-500/15">
          <el-icon><Files /></el-icon>
        </div>
      </div>
      <div class="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100">
        {{ formatBytes(stats.attachments.totalSizeBytes) }}
      </div>
      <div class="mt-1 text-xs text-slate-400">
        {{ t('admin.stats.r2Attachments', { count: stats.attachments.totalCount }) }}
      </div>
    </div>
  </div>
</template>
