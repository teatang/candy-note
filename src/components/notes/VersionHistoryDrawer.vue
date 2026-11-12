<script setup lang="ts">
import { RefreshLeft } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { resolveApiErrorMessage } from '@/api/client'
import { useLocaleStore } from '@/stores/locale'
import { useNoteStore } from '@/stores/note'
import type { NoteVersion } from '@/types'
import { formatDateTime } from '@/utils/date'

/**
 * 笔记一周（7天）内历史版本查看与回退抽屉组件
 * - 展示最近 7 天内的保存快照列表
 * - 支持预览历史版本原文以及与当前编辑内容的左右对比
 * - 支持一键回退并自动为回退前状态创建备份快照
 */
const props = defineProps<{
  modelValue: boolean
  noteId: string
  currentTitle: string
  currentContent: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
}>()

const { t } = useI18n()
const noteStore = useNoteStore()
const localeStore = useLocaleStore()

const loading = ref(false)
const rollingBack = ref(false)
const selectedVersionId = ref<string | null>(null)
const viewTab = ref<'preview' | 'compare'>('preview')

const selectedVersion = computed<NoteVersion | null>(
  () => noteStore.versions.find((v) => v.id === selectedVersionId.value) ?? null
)

watch(
  () => props.modelValue,
  async (open) => {
    if (!open) return
    loading.value = true
    try {
      const list = await noteStore.loadVersions(props.noteId)
      selectedVersionId.value = list[0]?.id ?? null
    } catch (err) {
      ElMessage.error(resolveApiErrorMessage(err))
    } finally {
      loading.value = false
    }
  }
)

async function handleRollback() {
  if (!selectedVersion.value) return
  const ver = selectedVersion.value
  try {
    await ElMessageBox.confirm(
      t('versions.rollbackConfirmMsg', { num: ver.versionNumber }),
      t('versions.rollbackConfirmTitle'),
      {
        type: 'warning',
        confirmButtonText: t('versions.rollbackBtn'),
        cancelButtonText: t('common.cancel')
      }
    )
    rollingBack.value = true
    await noteStore.rollbackVersion(props.noteId, ver.id)
    ElMessage.success(t('versions.rollbackSuccess', { num: ver.versionNumber }))
    emit('update:modelValue', false)
  } catch (err) {
    if (err !== 'cancel' && err !== 'close') {
      ElMessage.error(resolveApiErrorMessage(err))
    }
  } finally {
    rollingBack.value = false
  }
}
</script>

<template>
  <el-drawer
    :model-value="modelValue"
    :title="t('versions.title')"
    size="min(740px, 100vw)"
    append-to-body
    @update:model-value="(val: boolean) => emit('update:modelValue', val)"
  >
    <div class="flex h-full flex-col gap-3">
      <div class="text-xs text-slate-500 dark:text-slate-400">
        {{ t('versions.subtitle') }}
      </div>

      <div v-if="loading" class="py-12 text-center text-sm text-slate-400">
        {{ t('common.loading') }}
      </div>

      <div
        v-else-if="noteStore.versions.length === 0"
        class="py-12 text-center text-sm text-slate-400"
      >
        {{ t('versions.empty') }}
      </div>

      <div v-else class="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-12">
        <!-- 左侧：一周内版本时间线 -->
        <div
          class="max-h-44 space-y-2 overflow-y-auto border-b border-slate-200 pr-1 pb-3 md:col-span-4 md:max-h-none md:border-b-0 md:border-r md:pb-0 dark:border-slate-800"
        >
          <button
            v-for="ver in noteStore.versions"
            :key="ver.id"
            type="button"
            class="w-full rounded-xl border p-2.5 text-left transition"
            :class="
              selectedVersionId === ver.id
                ? 'border-rose-300 bg-rose-50/70 dark:border-rose-500/50 dark:bg-rose-500/15'
                : 'border-slate-200 hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-700'
            "
            @click="selectedVersionId = ver.id"
          >
            <div class="flex items-center justify-between">
              <span class="text-xs font-semibold text-slate-800 dark:text-slate-100">
                {{ t('versions.versionLabel', { num: ver.versionNumber }) }}
              </span>
              <el-tag size="small" effect="plain">
                {{ t(`versions.types.${ver.changeType}`) }}
              </el-tag>
            </div>
            <div class="mt-1 truncate text-xs text-slate-600 dark:text-slate-300">
              {{ ver.title || t('notes.untitled') }}
            </div>
            <div class="mt-1 text-[11px] text-slate-400">
              {{ formatDateTime(ver.createdAt, localeStore.locale) }}
            </div>
          </button>
        </div>

        <!-- 右侧：预览与回退操作区 -->
        <div v-if="selectedVersion" class="md:col-span-8 flex min-h-0 flex-col gap-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <el-radio-group v-model="viewTab" size="small">
              <el-radio-button value="preview">{{ t('versions.previewTab') }}</el-radio-button>
              <el-radio-button value="compare">{{ t('versions.compareTab') }}</el-radio-button>
            </el-radio-group>

            <el-button
              type="primary"
              size="small"
              :loading="rollingBack"
              @click="handleRollback"
            >
              <el-icon class="mr-1"><RefreshLeft /></el-icon>
              <span>{{ t('versions.rollbackBtn') }}</span>
            </el-button>
          </div>

          <div
            v-if="viewTab === 'preview'"
            class="flex-1 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <h4 class="mb-2 text-base font-semibold text-slate-900 dark:text-slate-100">
              {{ selectedVersion.title || t('notes.untitled') }}
            </h4>
            <pre class="whitespace-pre-wrap font-mono text-xs leading-6 text-slate-700 dark:text-slate-300">{{ selectedVersion.content }}</pre>
          </div>

          <div
            v-else
            class="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto sm:grid-cols-2 sm:overflow-hidden"
          >
            <div
              class="flex flex-col overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-900"
            >
              <div class="mb-2 text-xs font-semibold text-rose-500">
                {{ t('versions.snapshotHeader') }} (v{{ selectedVersion.versionNumber }})
              </div>
              <div class="mb-1 text-xs font-medium text-slate-800 dark:text-slate-100">
                {{ selectedVersion.title || t('notes.untitled') }}
              </div>
              <pre class="whitespace-pre-wrap font-mono text-[11px] leading-5 text-slate-600 dark:text-slate-300">{{ selectedVersion.content }}</pre>
            </div>

            <div
              class="flex flex-col overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950"
            >
              <div class="mb-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                {{ t('versions.currentHeader') }}
              </div>
              <div class="mb-1 text-xs font-medium text-slate-800 dark:text-slate-100">
                {{ currentTitle || t('notes.untitled') }}
              </div>
              <pre class="whitespace-pre-wrap font-mono text-[11px] leading-5 text-slate-600 dark:text-slate-300">{{ currentContent }}</pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  </el-drawer>
</template>
