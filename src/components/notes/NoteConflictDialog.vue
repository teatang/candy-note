<script setup lang="ts">
import { Close, FullScreen, ScaleToOriginal, WarningFilled } from '@element-plus/icons-vue'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLocaleStore } from '@/stores/locale'
import type { Note, NoteFormat } from '@/types'
import { formatDateTime } from '@/utils/date'

export interface NoteConflictPayload {
  noteId: string
  serverNote: Note
  localDraft: {
    title: string
    content: string
    format: NoteFormat
  }
}

/**
 * 多设备编辑冲突对比与确认弹窗
 * - 并排展示线上最新版本与本地待保存版本
 * - 支持在冲突页面直接编辑本地标题、格式与正文内容，并支持切换全屏编辑
 * - 等待用户确认后才执行覆盖保存，也支持放弃本地修改采用线上版本或取消继续编辑
 */
const props = defineProps<{
  modelValue: boolean
  conflict: NoteConflictPayload | null
  submitting?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'update:local-draft', value: NoteConflictPayload['localDraft']): void
  (e: 'confirm-overwrite'): void
  (e: 'use-server'): void
  (e: 'cancel'): void
}>()

const { t } = useI18n()
const localeStore = useLocaleStore()
const isFullscreen = ref(false)
const editableDraft = ref<NoteConflictPayload['localDraft']>({
  title: '',
  content: '',
  format: 'markdown'
})

watch(
  [
    () => props.modelValue,
    () => props.conflict?.noteId,
    () => props.conflict?.serverNote.updatedAt
  ],
  ([open]) => {
    if (!open) {
      isFullscreen.value = false
      return
    }
    if (props.conflict) {
      editableDraft.value = { ...props.conflict.localDraft }
    }
  },
  { immediate: true }
)

function handleWindowKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.modelValue && isFullscreen.value) {
    e.preventDefault()
    e.stopPropagation()
    isFullscreen.value = false
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleWindowKeydown, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleWindowKeydown, true)
})

function toggleFullscreen() {
  isFullscreen.value = !isFullscreen.value
}

function updateLocalDraft(patch: Partial<NoteConflictPayload['localDraft']>) {
  if (!props.conflict) return
  const next = {
    ...editableDraft.value,
    ...patch
  }
  editableDraft.value = next
  emit('update:local-draft', next)
}

function handleTitleInput(e: Event) {
  updateLocalDraft({ title: (e.target as HTMLInputElement).value })
}

function handleContentInput(e: Event) {
  updateLocalDraft({ content: (e.target as HTMLTextAreaElement).value })
}

function handleFormatSelect(format: NoteFormat) {
  updateLocalDraft({ format })
}

function handleClose() {
  if (props.submitting) return
  isFullscreen.value = false
  emit('update:modelValue', false)
  emit('cancel')
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :fullscreen="isFullscreen"
    :width="isFullscreen ? '100%' : 'min(980px, 95vw)'"
    :class="isFullscreen ? 'candy-conflict-dialog-fullscreen' : ''"
    :show-close="false"
    :close-on-press-escape="!isFullscreen && !submitting"
    :close-on-click-modal="false"
    append-to-body
    @update:model-value="(val: boolean) => !val && handleClose()"
  >
    <template #header="{ titleId, titleClass }">
      <div class="flex items-center justify-between gap-3">
        <span :id="titleId" :class="titleClass" class="font-semibold">
          {{ t('notes.conflictDialog.title') }}
        </span>
        <div class="flex items-center gap-1.5">
          <el-tooltip
            :content="isFullscreen ? t('notes.exitFullscreen') : t('notes.enterFullscreen')"
            placement="bottom"
          >
            <button
              type="button"
              data-testid="conflict-toggle-fullscreen"
              class="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:border-rose-300 hover:text-rose-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-rose-400"
              :class="
                isFullscreen
                  ? 'border-rose-300 bg-rose-50 text-rose-600 dark:border-rose-500/50 dark:bg-rose-500/15 dark:text-rose-300'
                  : ''
              "
              :aria-label="
                isFullscreen ? t('notes.exitFullscreen') : t('notes.enterFullscreen')
              "
              @click="toggleFullscreen"
            >
              <el-icon :size="15">
                <ScaleToOriginal v-if="isFullscreen" />
                <FullScreen v-else />
              </el-icon>
            </button>
          </el-tooltip>

          <button
            type="button"
            data-testid="conflict-header-close"
            :disabled="submitting"
            :aria-label="t('common.cancel')"
            class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            @click="handleClose"
          >
            <el-icon :size="16"><Close /></el-icon>
          </button>
        </div>
      </div>
    </template>

    <div
      v-if="conflict"
      data-testid="note-conflict-dialog"
      class="flex flex-col gap-4"
      :class="isFullscreen ? 'min-h-0 flex-1' : ''"
    >
      <div
        class="flex shrink-0 items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-xs leading-relaxed text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
      >
        <el-icon class="mt-0.5 shrink-0 text-amber-500" :size="16"><WarningFilled /></el-icon>
        <div class="space-y-1">
          <p>{{ t('notes.conflictDialog.description') }}</p>
          <p class="text-[11px] opacity-85">
            {{
              t('notes.conflictDialog.serverUpdatedAt', {
                time: formatDateTime(conflict.serverNote.updatedAt, localeStore.locale)
              })
            }}
          </p>
        </div>
      </div>

      <div
        class="grid grid-cols-1 gap-3 sm:grid-cols-2"
        :class="isFullscreen ? 'min-h-0 flex-1' : ''"
      >
        <!-- 线上最新版本（只读参照） -->
        <div
          data-testid="conflict-server-pane"
          class="flex flex-col overflow-hidden rounded-xl border border-emerald-200 bg-emerald-50/40 dark:border-emerald-500/30 dark:bg-emerald-950/20"
          :class="isFullscreen ? 'min-h-0 h-full' : 'h-80 sm:h-96'"
        >
          <div
            class="flex shrink-0 items-center justify-between border-b border-emerald-200/70 px-3 py-2 dark:border-emerald-500/20"
          >
            <span class="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
              {{ t('notes.conflictDialog.serverHeader') }}
            </span>
            <div class="flex items-center gap-2">
              <span class="text-[11px] text-slate-400">
                {{ t('notes.wordCount', { count: conflict.serverNote.content.length }) }}
              </span>
              <span
                class="rounded px-1.5 py-0.5 font-mono text-[10px] font-medium"
                :class="
                  conflict.serverNote.format === 'markdown'
                    ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300'
                    : 'bg-slate-200/80 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                "
              >
                {{ conflict.serverNote.format === 'markdown' ? 'MD' : 'TXT' }}
              </span>
            </div>
          </div>
          <div class="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            <div class="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {{ conflict.serverNote.title || t('notes.untitled') }}
            </div>
            <pre
              class="whitespace-pre-wrap break-words font-mono text-xs leading-6 text-slate-700 dark:text-slate-300"
            >{{ conflict.serverNote.content }}</pre>
          </div>
        </div>

        <!-- 本地待保存版本（支持直接编辑标题、格式与正文内容） -->
        <div
          data-testid="conflict-local-pane"
          class="flex flex-col overflow-hidden rounded-xl border border-rose-200 bg-rose-50/40 dark:border-rose-500/30 dark:bg-rose-950/20"
          :class="isFullscreen ? 'min-h-0 h-full' : 'h-80 sm:h-96'"
        >
          <div
            class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-rose-200/70 px-3 py-2 dark:border-rose-500/20"
          >
            <div class="flex items-center gap-1.5">
              <span class="text-xs font-semibold text-rose-600 dark:text-rose-300">
                {{ t('notes.conflictDialog.localHeader') }}
              </span>
              <span
                class="rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-600 dark:bg-rose-500/20 dark:text-rose-300"
              >
                {{ t('notes.conflictDialog.editableBadge') }}
              </span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-[11px] text-slate-400">
                {{ t('notes.wordCount', { count: editableDraft.content.length }) }}
              </span>
              <div class="flex items-center rounded-md bg-white/80 p-0.5 dark:bg-slate-800/80">
                <button
                  type="button"
                  data-testid="conflict-local-format-markdown"
                  class="rounded px-1.5 py-0.5 font-mono text-[10px] font-medium transition"
                  :class="
                    editableDraft.format === 'markdown'
                      ? 'bg-indigo-50 text-indigo-600 shadow-2xs dark:bg-indigo-500/25 dark:text-indigo-300'
                      : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
                  "
                  @click="handleFormatSelect('markdown')"
                >
                  MD
                </button>
                <button
                  type="button"
                  data-testid="conflict-local-format-plain"
                  class="rounded px-1.5 py-0.5 font-mono text-[10px] font-medium transition"
                  :class="
                    editableDraft.format === 'plain'
                      ? 'bg-slate-200 text-slate-800 shadow-2xs dark:bg-slate-700 dark:text-slate-100'
                      : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
                  "
                  @click="handleFormatSelect('plain')"
                >
                  TXT
                </button>
              </div>
            </div>
          </div>
          <div class="flex min-h-0 flex-1 flex-col gap-2 p-3">
            <input
              data-testid="conflict-local-title-input"
              type="text"
              maxlength="200"
              :value="editableDraft.title"
              :placeholder="t('notes.titlePlaceholder')"
              class="w-full shrink-0 rounded-lg border border-rose-200/80 bg-white/85 px-2.5 py-1.5 text-sm font-semibold text-slate-900 placeholder-slate-400 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-200/60 dark:border-rose-500/30 dark:bg-slate-900/75 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-rose-400 dark:focus:ring-rose-500/20"
              @input="handleTitleInput"
            />
            <textarea
              data-testid="conflict-local-content-input"
              :value="editableDraft.content"
              :placeholder="t('notes.conflictDialog.contentPlaceholder')"
              class="min-h-0 w-full flex-1 resize-none rounded-lg border border-rose-200/80 bg-white/85 p-2.5 font-mono text-xs leading-6 text-slate-800 placeholder-slate-400 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-200/60 dark:border-rose-500/30 dark:bg-slate-900/75 dark:text-slate-200 dark:placeholder-slate-500 dark:focus:border-rose-400 dark:focus:ring-rose-500/20"
              @input="handleContentInput"
            />
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex flex-wrap items-center justify-end gap-2">
        <el-button data-testid="conflict-cancel" :disabled="submitting" @click="handleClose">
          {{ t('notes.conflictDialog.cancelBtn') }}
        </el-button>
        <el-button
          data-testid="conflict-use-server"
          plain
          :disabled="submitting"
          @click="emit('use-server')"
        >
          {{ t('notes.conflictDialog.useServerBtn') }}
        </el-button>
        <el-button
          data-testid="conflict-confirm-save"
          type="primary"
          :loading="submitting"
          @click="emit('confirm-overwrite')"
        >
          {{ t('notes.conflictDialog.confirmSaveBtn') }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style>
.candy-conflict-dialog-fullscreen.el-dialog.is-fullscreen {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.candy-conflict-dialog-fullscreen.el-dialog.is-fullscreen .el-dialog__body {
  display: flex;
  flex: 1 1 0%;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
}
</style>
