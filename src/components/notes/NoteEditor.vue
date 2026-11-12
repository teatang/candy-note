<script setup lang="ts">
import {
  ArrowLeft,
  Check,
  Clock,
  Delete,
  Document,
  FullScreen,
  Picture,
  ScaleToOriginal,
  Top,
  Upload
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { resolveApiErrorMessage } from '@/api/client'
import { useLayoutStore } from '@/stores/layout'
import { useNoteStore } from '@/stores/note'
import type { NoteFormat } from '@/types'
import { formatBytes } from '@/utils/date'
import { renderMarkdownSafe } from '@/utils/markdown'
import VersionHistoryDrawer from './VersionHistoryDrawer.vue'

/**
 * 笔记核心编辑器组件
 * - 支持普通文本 (plain) 与 Markdown (markdown) 双格式实时切换
 * - Markdown 模式支持分栏边写边预览 (split)、纯编辑 (edit)、纯预览 (preview)
 * - 支持编辑与预览全屏模式（点击按钮进入，支持按钮或按 Esc 键退出）
 * - 支持响应式布局：移动端提供返回笔记列表栏操作与自适应分栏高度
 * - 支持直接拖入图片、粘贴剪贴板图片或点击上传图片保存至 Cloudflare R2
 * - 内置节流自动保存 + Ctrl/Cmd+S 手动保存 + 一周历史版本抽屉入口
 */
const { t } = useI18n()
const noteStore = useNoteStore()
const layoutStore = useLayoutStore()

const draftTitle = ref('')
const draftContent = ref('')
const draftFormat = ref<NoteFormat>('markdown')
const draftFolderId = ref<string | null>(null)
const viewMode = ref<'split' | 'edit' | 'preview'>('split')
const isDraggingFile = ref(false)
const historyOpen = ref(false)
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)

let autoSaveTimer: ReturnType<typeof setTimeout> | null = null
let syncingFromStore = false

/** 同步当前选中笔记数据到本地草稿状态 */
watch(
  () => noteStore.activeNote,
  (note) => {
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer)
      autoSaveTimer = null
    }
    syncingFromStore = true
    if (note) {
      draftTitle.value = note.title
      draftContent.value = note.content
      draftFormat.value = note.format
      draftFolderId.value = note.folderId
    } else {
      draftTitle.value = ''
      draftContent.value = ''
      if (layoutStore.isEditorFullscreen) {
        layoutStore.toggleEditorFullscreen(false)
      }
    }
    setTimeout(() => {
      syncingFromStore = false
    }, 0)
  },
  { immediate: true }
)

/** 全局按键监听：全屏模式下按 Esc 键快速退出（历史抽屉未打开时） */
function handleWindowKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && layoutStore.isEditorFullscreen && !historyOpen.value) {
    layoutStore.toggleEditorFullscreen(false)
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleWindowKeydown)
})

onBeforeUnmount(() => {
  if (autoSaveTimer) clearTimeout(autoSaveTimer)
  window.removeEventListener('keydown', handleWindowKeydown)
})

const renderedMarkdownHtml = computed(() => {
  if (draftFormat.value !== 'markdown') return ''
  return renderMarkdownSafe(draftContent.value)
})

const hasUnsavedChanges = computed(() => {
  const note = noteStore.activeNote
  if (!note) return false
  return (
    draftTitle.value !== note.title ||
    draftContent.value !== note.content ||
    draftFormat.value !== note.format
  )
})

/** 安排 1.5 秒自动保存防抖 */
function scheduleAutoSave() {
  if (syncingFromStore || !noteStore.activeNote) return
  noteStore.savingState = 'idle'
  if (autoSaveTimer) clearTimeout(autoSaveTimer)
  const targetId = noteStore.activeNote.id
  autoSaveTimer = setTimeout(async () => {
    if (!noteStore.activeNote || noteStore.activeNote.id !== targetId) return
    try {
      await noteStore.saveNote(targetId, {
        title: draftTitle.value,
        content: draftContent.value,
        format: draftFormat.value,
        changeType: 'auto_save'
      })
    } catch {
      // 错误状态已在 store 中标记
    }
  }, 1500)
}

/** 立即执行手动保存并生成历史快照 */
async function handleManualSave() {
  const note = noteStore.activeNote
  if (!note) return
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer)
    autoSaveTimer = null
  }
  try {
    await noteStore.saveNote(note.id, {
      title: draftTitle.value,
      content: draftContent.value,
      format: draftFormat.value,
      changeType: 'save'
    })
    ElMessage.success(t('common.saved'))
  } catch (err) {
    ElMessage.error(resolveApiErrorMessage(err))
  }
}

async function handleFormatChange(format: NoteFormat) {
  draftFormat.value = format
  const note = noteStore.activeNote
  if (!note) return
  try {
    await noteStore.saveNote(note.id, {
      title: draftTitle.value,
      content: draftContent.value,
      format,
      changeType: 'save'
    })
  } catch (err) {
    ElMessage.error(resolveApiErrorMessage(err))
  }
}

async function handleFolderChange(folderId: string | null) {
  const note = noteStore.activeNote
  if (!note) return
  try {
    await noteStore.moveNoteToFolder(note.id, folderId || null)
  } catch (err) {
    ElMessage.error(resolveApiErrorMessage(err))
  }
}

/** 移动端返回笔记列表（若处于全屏则先退出全屏） */
function handleMobileBack() {
  layoutStore.toggleEditorFullscreen(false)
  layoutStore.setMobilePane('list')
}

async function handleDeleteNote() {
  const note = noteStore.activeNote
  if (!note) return
  try {
    await ElMessageBox.confirm(
      t('notes.deleteConfirmMsg', { title: note.title || t('notes.untitled') }),
      t('notes.deleteConfirmTitle'),
      {
        type: 'warning',
        confirmButtonText: t('common.delete'),
        cancelButtonText: t('common.cancel')
      }
    )
    await noteStore.deleteNote(note.id)
    if (!noteStore.activeNote) {
      handleMobileBack()
    }
    ElMessage.success(t('common.success'))
  } catch (err) {
    if (err !== 'cancel' && err !== 'close') {
      ElMessage.error(resolveApiErrorMessage(err))
    }
  }
}

/** 在当前光标位置插入 Markdown 片段或普通文本 */
function insertAtCursor(snippet: string) {
  const el = textareaRef.value
  if (!el) {
    draftContent.value += snippet
    scheduleAutoSave()
    return
  }
  const start = el.selectionStart ?? draftContent.value.length
  const end = el.selectionEnd ?? draftContent.value.length
  const before = draftContent.value.slice(0, start)
  const after = draftContent.value.slice(end)
  draftContent.value = `${before}${snippet}${after}`
  scheduleAutoSave()
  requestAnimationFrame(() => {
    el.focus()
    const pos = start + snippet.length
    el.setSelectionRange(pos, pos)
  })
}

/** 包裹选中文字（用于粗体、斜体等格式） */
function wrapSelection(prefix: string, suffix = prefix, placeholder = 'text') {
  const el = textareaRef.value
  if (!el) {
    insertAtCursor(`${prefix}${placeholder}${suffix}`)
    return
  }
  const start = el.selectionStart ?? 0
  const end = el.selectionEnd ?? 0
  const selected = draftContent.value.slice(start, end) || placeholder
  const before = draftContent.value.slice(0, start)
  const after = draftContent.value.slice(end)
  draftContent.value = `${before}${prefix}${selected}${suffix}${after}`
  scheduleAutoSave()
  requestAnimationFrame(() => {
    el.focus()
    el.setSelectionRange(start + prefix.length, start + prefix.length + selected.length)
  })
}

/** 上传图片至 R2 并按当前笔记格式自动插入引用 */
async function uploadImageFiles(files: File[]) {
  const note = noteStore.activeNote
  if (!note) return
  const imageFiles = files.filter((f) => f.type.startsWith('image/'))
  if (imageFiles.length === 0) return

  for (const file of imageFiles) {
    try {
      const attachment = await noteStore.uploadImage(file, note.id)
      if (draftFormat.value === 'markdown') {
        insertAtCursor(`\n![${attachment.filename}](${attachment.url})\n`)
      } else {
        insertAtCursor(`\n[${attachment.filename}] ${attachment.url}\n`)
      }
      ElMessage.success(t('notes.uploadImageSuccess'))
    } catch (err) {
      ElMessage.error(resolveApiErrorMessage(err))
    }
  }
}

function handleFileInputChange(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files && input.files.length > 0) {
    uploadImageFiles(Array.from(input.files))
    input.value = ''
  }
}

function handleDropFiles(e: DragEvent) {
  isDraggingFile.value = false
  if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
    e.preventDefault()
    uploadImageFiles(Array.from(e.dataTransfer.files))
  }
}

function handleDragOverFiles(e: DragEvent) {
  if (e.dataTransfer?.types.includes('Files')) {
    e.preventDefault()
    isDraggingFile.value = true
  }
}

function handlePaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  const files: File[] = []
  for (const item of items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) files.push(file)
    }
  }
  if (files.length > 0) {
    e.preventDefault()
    uploadImageFiles(files)
  }
}

async function handleDeleteAttachment(id: string) {
  try {
    await ElMessageBox.confirm(t('notes.deleteAttachmentConfirm'), t('common.delete'), {
      type: 'warning',
      confirmButtonText: t('common.delete'),
      cancelButtonText: t('common.cancel')
    })
    await noteStore.deleteAttachment(id)
    ElMessage.success(t('common.success'))
  } catch (err) {
    if (err !== 'cancel' && err !== 'close') {
      ElMessage.error(resolveApiErrorMessage(err))
    }
  }
}

function handleKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    handleManualSave()
  }
}
</script>

<template>
  <main
    data-testid="note-editor"
    class="min-w-0 w-full flex-col bg-white dark:bg-slate-950"
    :class="
      layoutStore.isEditorFullscreen
        ? 'fixed inset-0 z-50 flex h-full'
        : [
            'relative flex-1',
            layoutStore.mobilePane === 'editor' ? 'flex' : 'hidden md:flex'
          ]
    "
  >
    <!-- 未选中笔记空状态 -->
    <div
      v-if="!noteStore.activeNote"
      class="flex flex-1 flex-col items-center justify-center p-8 text-center"
    >
      <div
        class="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-50 text-rose-500 dark:bg-rose-500/15"
      >
        <el-icon :size="30"><Document /></el-icon>
      </div>
      <h3 class="text-base font-semibold text-slate-800 dark:text-slate-100">
        {{ t('notes.emptyEditorTitle') }}
      </h3>
      <p class="mt-1.5 max-w-md text-xs leading-relaxed text-slate-400">
        {{ t('notes.emptyEditorSubtitle') }}
      </p>
      <el-button size="small" class="mt-4 md:hidden" @click="handleMobileBack">
        <el-icon class="mr-1"><ArrowLeft /></el-icon>
        <span>{{ t('layout.backToList') }}</span>
      </el-button>
    </div>

    <!-- 已选中笔记编辑器主体 -->
    <template v-else>
      <!-- 顶部属性与操作栏 -->
      <div
        class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 px-3 py-2 sm:px-5 sm:py-2.5 dark:border-slate-800"
      >
        <div class="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <!-- 移动端返回笔记列表按钮 -->
          <button
            type="button"
            data-testid="mobile-back-to-list"
            class="inline-flex h-7 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-600 transition hover:border-rose-300 hover:text-rose-500 md:hidden dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            :aria-label="t('layout.backToList')"
            @click="handleMobileBack"
          >
            <el-icon><ArrowLeft /></el-icon>
            <span>{{ t('layout.backToList') }}</span>
          </button>

          <!-- 所属文件夹选择 -->
          <el-select
            :model-value="draftFolderId ?? ''"
            size="small"
            class="!w-28 sm:!w-36"
            @change="(val: string) => handleFolderChange(val || null)"
          >
            <el-option :label="t('folders.uncategorized')" value="" />
            <el-option
              v-for="f in noteStore.orderedFolders"
              :key="f.id"
              :label="`${'— '.repeat(f.depth)}${f.name}`"
              :value="f.id"
            />
          </el-select>

          <!-- 格式切换：普通文本 / Markdown -->
          <div class="flex items-center rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
            <button
              type="button"
              class="rounded-md px-2 py-1 text-xs transition sm:px-2.5"
              :class="
                draftFormat === 'markdown'
                  ? 'bg-white font-medium text-rose-600 shadow-xs dark:bg-slate-700 dark:text-rose-300'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
              "
              @click="handleFormatChange('markdown')"
            >
              {{ t('notes.formatMarkdown') }}
            </button>
            <button
              type="button"
              class="rounded-md px-2 py-1 text-xs transition sm:px-2.5"
              :class="
                draftFormat === 'plain'
                  ? 'bg-white font-medium text-rose-600 shadow-xs dark:bg-slate-700 dark:text-rose-300'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
              "
              @click="handleFormatChange('plain')"
            >
              {{ t('notes.formatPlain') }}
            </button>
          </div>

          <!-- Markdown 分栏预览模式切换 -->
          <div
            v-if="draftFormat === 'markdown'"
            class="flex items-center rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800"
          >
            <button
              v-for="m in [
                { key: 'split', label: t('notes.viewModeSplit') },
                { key: 'edit', label: t('notes.viewModeEdit') },
                { key: 'preview', label: t('notes.viewModePreview') }
              ]"
              :key="m.key"
              type="button"
              class="rounded-md px-2 py-1 text-xs transition"
              :class="
                viewMode === m.key
                  ? 'bg-white font-medium text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
              "
              @click="viewMode = m.key as 'split' | 'edit' | 'preview'"
            >
              {{ m.label }}
            </button>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <span class="text-[11px] text-slate-400 sm:text-xs">
            <template v-if="noteStore.savingState === 'saving'">{{ t('common.saving') }}</template>
            <template v-else-if="hasUnsavedChanges">{{ t('common.unsaved') }}</template>
            <template v-else>{{ t('common.saved') }}</template>
          </span>

          <el-tooltip
            :content="noteStore.activeNote.isPinned ? t('notes.unpin') : t('notes.pin')"
            placement="top"
          >
            <el-button
              size="small"
              :type="noteStore.activeNote.isPinned ? 'primary' : 'default'"
              plain
              class="!m-0 !rounded-lg"
              @click="noteStore.togglePin(noteStore.activeNote)"
            >
              <el-icon><Top /></el-icon>
            </el-button>
          </el-tooltip>

          <el-button size="small" plain class="!m-0 !rounded-lg" @click="historyOpen = true">
            <el-icon class="lg:mr-1"><Clock /></el-icon>
            <span class="hidden lg:inline">{{ t('versions.title') }}</span>
          </el-button>

          <!-- 全屏编辑/查看切换按钮（Markdown 与普通文本模式均支持） -->
          <el-tooltip
            :content="
              layoutStore.isEditorFullscreen
                ? t('notes.exitFullscreen')
                : t('notes.enterFullscreen')
            "
            placement="top"
          >
            <el-button
              data-testid="toggle-fullscreen"
              size="small"
              :type="layoutStore.isEditorFullscreen ? 'primary' : 'default'"
              plain
              class="!m-0 !rounded-lg"
              :aria-label="
                layoutStore.isEditorFullscreen
                  ? t('notes.exitFullscreen')
                  : t('notes.enterFullscreen')
              "
              @click="layoutStore.toggleEditorFullscreen()"
            >
              <el-icon>
                <ScaleToOriginal v-if="layoutStore.isEditorFullscreen" />
                <FullScreen v-else />
              </el-icon>
            </el-button>
          </el-tooltip>

          <el-button size="small" type="primary" class="!m-0 !rounded-lg" @click="handleManualSave">
            <el-icon class="mr-1"><Check /></el-icon>
            <span>{{ t('common.save') }}</span>
          </el-button>

          <el-button
            size="small"
            type="danger"
            plain
            class="!m-0 !rounded-lg"
            @click="handleDeleteNote"
          >
            <el-icon><Delete /></el-icon>
          </el-button>
        </div>
      </div>

      <!-- 笔记标题栏 -->
      <div class="border-b border-slate-100 px-4 py-2.5 sm:px-6 sm:py-3 dark:border-slate-800/80">
        <input
          v-model="draftTitle"
          type="text"
          :placeholder="t('notes.titlePlaceholder')"
          maxlength="200"
          class="w-full bg-transparent text-lg font-bold text-slate-900 placeholder-slate-300 outline-none sm:text-xl dark:text-slate-100 dark:placeholder-slate-600"
          @input="scheduleAutoSave"
          @keydown="handleKeydown"
        />
      </div>

      <!-- 快捷编辑工具栏（含 R2 图片上传按钮） -->
      <div
        class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/60 px-3 py-1.5 sm:px-5 dark:border-slate-800 dark:bg-slate-900/60"
      >
        <div class="flex flex-wrap items-center gap-1">
          <template v-if="draftFormat === 'markdown' && viewMode !== 'preview'">
            <button
              type="button"
              class="rounded px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800"
              :title="t('notes.toolbar.h1')"
              @click="insertAtCursor('\n# ')"
            >
              H1
            </button>
            <button
              type="button"
              class="rounded px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800"
              :title="t('notes.toolbar.h2')"
              @click="insertAtCursor('\n## ')"
            >
              H2
            </button>
            <button
              type="button"
              class="rounded px-2 py-1 text-xs font-bold text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800"
              :title="t('notes.toolbar.bold')"
              @click="wrapSelection('**', '**', 'bold')"
            >
              B
            </button>
            <button
              type="button"
              class="rounded px-2 py-1 text-xs italic text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800"
              :title="t('notes.toolbar.italic')"
              @click="wrapSelection('*', '*', 'italic')"
            >
              I
            </button>
            <button
              type="button"
              class="rounded px-2 py-1 font-mono text-xs text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800"
              :title="t('notes.toolbar.code')"
              @click="insertAtCursor('\n```\n\n```\n')"
            >
              &lt;/&gt;
            </button>
            <button
              type="button"
              class="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800"
              :title="t('notes.toolbar.quote')"
              @click="insertAtCursor('\n> ')"
            >
              &ldquo;
            </button>
            <button
              type="button"
              class="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800"
              :title="t('notes.toolbar.list')"
              @click="insertAtCursor('\n- ')"
            >
              • List
            </button>
            <button
              type="button"
              class="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800"
              :title="t('notes.toolbar.task')"
              @click="insertAtCursor('\n- [ ] ')"
            >
              [x]
            </button>
            <button
              type="button"
              class="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800"
              :title="t('notes.toolbar.table')"
              @click="insertAtCursor('\n| 列1 | 列2 |\n| --- | --- |\n| 内容 | 内容 |\n')"
            >
              Table
            </button>
          </template>

          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-rose-600 transition hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-500/15"
            @click="fileInputRef?.click()"
          >
            <el-icon><Picture /></el-icon>
            <span>{{
              noteStore.uploadingImage ? t('notes.uploadingImage') : t('notes.uploadImageBtn')
            }}</span>
          </button>
          <input
            ref="fileInputRef"
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            multiple
            class="hidden"
            @change="handleFileInputChange"
          />
        </div>

        <div class="text-[11px] text-slate-400">
          {{ t('notes.wordCount', { count: draftContent.length }) }}
        </div>
      </div>

      <!-- 编辑与预览主体区（支持拖入图片文件到编辑器直接上传至 Cloudflare R2） -->
      <div
        class="relative flex min-h-0 flex-1 flex-col overflow-hidden"
        @dragenter="handleDragOverFiles"
        @dragover="handleDragOverFiles"
        @dragleave="isDraggingFile = false"
        @drop="handleDropFiles"
      >
        <!-- 图片拖入高亮浮层 -->
        <div
          v-if="isDraggingFile"
          class="pointer-events-none absolute inset-3 z-20 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-rose-400 bg-rose-50/90 text-rose-600 backdrop-blur-xs dark:bg-rose-950/80 dark:text-rose-200"
        >
          <el-icon :size="36" class="mb-2"><Upload /></el-icon>
          <span class="text-sm font-medium">{{ t('notes.dropImageOverlay') }}</span>
        </div>

        <!-- Markdown 编辑器（分栏 / 纯编辑 / 纯预览） -->
        <div
          v-if="draftFormat === 'markdown'"
          class="grid min-h-0 flex-1"
          :class="
            viewMode === 'split'
              ? 'grid-cols-1 grid-rows-2 md:grid-cols-2 md:grid-rows-1'
              : 'grid-cols-1'
          "
        >
          <textarea
            v-if="viewMode === 'split' || viewMode === 'edit'"
            ref="textareaRef"
            v-model="draftContent"
            :placeholder="t('notes.contentPlaceholderMarkdown')"
            class="min-h-0 h-full w-full resize-none border-0 bg-transparent p-4 font-mono text-sm leading-7 text-slate-800 outline-none placeholder:text-slate-400 sm:p-6 dark:text-slate-200 dark:placeholder:text-slate-600"
            :class="
              viewMode === 'split'
                ? 'border-b md:border-b-0 md:border-r border-slate-200/80 dark:border-slate-800'
                : ''
            "
            @input="scheduleAutoSave"
            @paste="handlePaste"
            @keydown="handleKeydown"
          />

          <div
            v-if="viewMode === 'split' || viewMode === 'preview'"
            class="candy-markdown-body min-h-0 h-full overflow-y-auto p-4 text-slate-800 sm:p-6 dark:text-slate-200"
            v-html="renderedMarkdownHtml"
          />
        </div>

        <!-- 普通文本编辑器 -->
        <textarea
          v-else
          ref="textareaRef"
          v-model="draftContent"
          :placeholder="t('notes.contentPlaceholderPlain')"
          class="min-h-0 w-full flex-1 resize-none border-0 bg-transparent p-4 text-sm leading-7 text-slate-800 outline-none placeholder:text-slate-400 sm:p-6 dark:text-slate-200 dark:placeholder:text-slate-600"
          @input="scheduleAutoSave"
          @paste="handlePaste"
          @keydown="handleKeydown"
        />

        <!-- 当前笔记关联的 R2 图片附件条 -->
        <div
          v-if="noteStore.attachments.length > 0"
          class="border-t border-slate-200/80 bg-slate-50/70 px-3 py-2 sm:px-5 sm:py-2.5 dark:border-slate-800 dark:bg-slate-900/70"
        >
          <div class="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">
            {{ t('notes.attachmentsTitle', { count: noteStore.attachments.length }) }}
          </div>
          <div class="flex gap-2.5 overflow-x-auto pb-1">
            <div
              v-for="att in noteStore.attachments"
              :key="att.id"
              class="group relative flex shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white p-1.5 pr-7 shadow-2xs dark:border-slate-700 dark:bg-slate-800"
            >
              <img
                :src="att.url"
                :alt="att.filename"
                class="h-10 w-10 rounded-lg object-cover"
              />
              <div class="max-w-32 text-[11px]">
                <div class="truncate font-medium text-slate-700 dark:text-slate-200">
                  {{ att.filename }}
                </div>
                <div class="text-slate-400">{{ formatBytes(att.size) }}</div>
              </div>
              <button
                type="button"
                class="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-500/20"
                @click="handleDeleteAttachment(att.id)"
              >
                <el-icon :size="11"><Delete /></el-icon>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 一周内历史版本回退抽屉 -->
      <VersionHistoryDrawer
        v-model="historyOpen"
        :note-id="noteStore.activeNote.id"
        :current-title="draftTitle"
        :current-content="draftContent"
      />
    </template>
  </main>
</template>
