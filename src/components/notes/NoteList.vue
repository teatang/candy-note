<script setup lang="ts">
import {
  Document,
  DocumentAdd,
  EditPen,
  Fold,
  FolderOpened,
  Rank,
  Search,
  Top
} from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { resolveApiErrorMessage } from '@/api/client'
import { useLayoutStore } from '@/stores/layout'
import { useLocaleStore } from '@/stores/locale'
import { useNoteStore } from '@/stores/note'
import type { Note, NoteFormat } from '@/types'
import { formatRelativeTime } from '@/utils/date'

/**
 * 笔记列表栏组件
 * - 桌面端支持一键折叠/展开
 * - 移动端全宽展示，点击或新建笔记后自动切入编辑器视图
 * - 支持关键词搜索、格式筛选、置顶排序与拖动排序
 */
const { t } = useI18n()
const noteStore = useNoteStore()
const localeStore = useLocaleStore()
const layoutStore = useLayoutStore()

const draggingNoteId = ref<string | null>(null)
const dragOverNoteId = ref<string | null>(null)
const dragPosition = ref<'before' | 'after' | null>(null)

const currentFolderTitle = computed(() => {
  if (noteStore.activeFolderId === 'all') return t('folders.allNotes')
  if (noteStore.activeFolderId === 'uncategorized') return t('folders.uncategorized')
  return (
    noteStore.folders.find((f) => f.id === noteStore.activeFolderId)?.name ||
    t('notes.listTitle')
  )
})

async function handleSelectNote(noteId: string) {
  await noteStore.selectNote(noteId)
  layoutStore.setMobilePane('editor')
}

async function handleCreate(format: NoteFormat) {
  try {
    await noteStore.createNote(format)
    layoutStore.setMobilePane('editor')
  } catch (err) {
    ElMessage.error(resolveApiErrorMessage(err))
  }
}

async function handleTogglePin(e: Event, note: Note) {
  e.stopPropagation()
  try {
    await noteStore.togglePin(note)
  } catch (err) {
    ElMessage.error(resolveApiErrorMessage(err))
  }
}

function extractPreview(content: string): string {
  return content.replace(/[#>*`!\[\]()]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 72)
}

function onDragStart(e: DragEvent, note: Note) {
  draggingNoteId.value = note.id
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('application/x-candy-note-id', note.id)
  }
}

function onDragEnd() {
  draggingNoteId.value = null
  dragOverNoteId.value = null
  dragPosition.value = null
}

function onDragOver(e: DragEvent, target: Note) {
  if (!e.dataTransfer?.types.includes('application/x-candy-note-id')) return
  const dragged = noteStore.allNotes.find((n) => n.id === draggingNoteId.value)
  // 置顶与非置顶分组各自独立排序
  if (dragged && dragged.isPinned !== target.isPinned) return

  e.preventDefault()
  dragOverNoteId.value = target.id
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  dragPosition.value = e.clientY - rect.top < rect.height / 2 ? 'before' : 'after'
}

async function onDrop(e: DragEvent, target: Note) {
  e.preventDefault()
  const draggedId = e.dataTransfer?.getData('application/x-candy-note-id')
  const pos = dragPosition.value || 'before'
  dragOverNoteId.value = null
  dragPosition.value = null
  draggingNoteId.value = null

  if (!draggedId || draggedId === target.id) return
  try {
    await noteStore.reorderNotes(draggedId, target.id, pos)
  } catch (err) {
    ElMessage.error(resolveApiErrorMessage(err))
  }
}
</script>

<template>
  <section
    data-testid="note-list-sidebar"
    class="h-full shrink-0 flex-col border-r border-slate-200/80 bg-white transition-all duration-200 dark:border-slate-800 dark:bg-slate-900"
    :class="[
      layoutStore.mobilePane === 'list' ? 'flex w-full' : 'hidden md:flex',
      layoutStore.noteListCollapsed
        ? 'md:w-0 md:overflow-hidden md:border-r-0 md:opacity-0'
        : 'md:w-76 md:opacity-100'
    ]"
  >
    <!-- 顶部栏：当前文件夹标题 + 移动端快速切换文件夹 + 桌面端折叠按钮 -->
    <div
      class="flex items-center justify-between border-b border-slate-100 px-3 pt-2.5 pb-2 dark:border-slate-800"
    >
      <button
        type="button"
        class="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-slate-600 md:pointer-events-none dark:text-slate-300"
        @click="layoutStore.setMobileFoldersOpen(true)"
      >
        <el-icon class="text-amber-500 md:hidden"><FolderOpened /></el-icon>
        <span class="truncate">{{ currentFolderTitle }}</span>
        <span class="text-slate-400">({{ noteStore.filteredNotes.length }})</span>
      </button>

      <el-tooltip :content="t('layout.collapseNotes')" placement="top">
        <button
          type="button"
          class="hidden h-6 w-6 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 md:flex dark:hover:bg-slate-800 dark:hover:text-slate-200"
          :aria-label="t('layout.collapseNotes')"
          @click="layoutStore.toggleNoteList(true)"
        >
          <el-icon :size="13"><Fold /></el-icon>
        </button>
      </el-tooltip>
    </div>

    <!-- 新建按钮与搜索过滤区 -->
    <div class="space-y-2.5 border-b border-slate-100 p-3 dark:border-slate-800">
      <div class="grid grid-cols-2 gap-2">
        <el-button
          type="primary"
          size="small"
          class="!m-0 !rounded-xl"
          @click="handleCreate('markdown')"
        >
          <el-icon class="mr-1"><EditPen /></el-icon>
          <span>{{ t('notes.newMarkdown') }}</span>
        </el-button>
        <el-button
          size="small"
          plain
          class="!m-0 !rounded-xl"
          @click="handleCreate('plain')"
        >
          <el-icon class="mr-1"><DocumentAdd /></el-icon>
          <span>{{ t('notes.newPlain') }}</span>
        </el-button>
      </div>

      <el-input
        v-model="noteStore.searchQuery"
        size="small"
        clearable
        :prefix-icon="Search"
        :placeholder="t('notes.searchPlaceholder')"
      />

      <div class="flex items-center gap-1 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
        <button
          v-for="opt in [
            { value: 'all', label: t('notes.allFormats') },
            { value: 'markdown', label: t('notes.formatMarkdown') },
            { value: 'plain', label: t('notes.formatPlain') }
          ]"
          :key="opt.value"
          type="button"
          class="flex-1 rounded-md py-1 text-xs transition"
          :class="
            noteStore.formatFilter === opt.value
              ? 'bg-white font-medium text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
              : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
          "
          @click="noteStore.formatFilter = opt.value as 'all' | 'markdown' | 'plain'"
        >
          {{ opt.label }}
        </button>
      </div>
    </div>

    <!-- 笔记卡片滚动区 -->
    <div class="flex-1 overflow-y-auto p-2 space-y-3">
      <div
        v-if="noteStore.filteredNotes.length === 0"
        class="flex flex-col items-center justify-center px-4 py-12 text-center text-xs text-slate-400"
      >
        <el-icon :size="28" class="mb-2 opacity-60"><Document /></el-icon>
        <p>{{ t('notes.emptyList') }}</p>
      </div>

      <!-- 置顶笔记区 -->
      <div v-if="noteStore.pinnedNotes.length > 0" class="space-y-1.5">
        <div class="flex items-center gap-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-rose-500">
          <el-icon :size="12"><Top /></el-icon>
          <span>{{ t('notes.pinnedSection') }}</span>
        </div>

        <div
          v-for="note in noteStore.pinnedNotes"
          :key="note.id"
          draggable="true"
          class="group relative cursor-pointer rounded-xl border p-2.5 transition"
          :class="[
            noteStore.activeNoteId === note.id
              ? 'border-rose-300 bg-rose-50/70 shadow-xs dark:border-rose-500/50 dark:bg-rose-500/10'
              : 'border-slate-100 bg-slate-50/60 hover:border-slate-200 dark:border-slate-800 dark:bg-slate-800/40 dark:hover:border-slate-700',
            draggingNoteId === note.id ? 'opacity-45' : '',
            dragOverNoteId === note.id && dragPosition === 'before'
              ? 'border-t-2 border-t-rose-500'
              : '',
            dragOverNoteId === note.id && dragPosition === 'after'
              ? 'border-b-2 border-b-rose-500'
              : ''
          ]"
          @click="handleSelectNote(note.id)"
          @dragstart="(e) => onDragStart(e, note)"
          @dragend="onDragEnd"
          @dragover="(e) => onDragOver(e, note)"
          @dragleave="dragOverNoteId = null"
          @drop="(e) => onDrop(e, note)"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="flex min-w-0 items-center gap-1.5">
              <el-icon class="shrink-0 cursor-grab text-slate-300 group-hover:text-slate-400">
                <Rank />
              </el-icon>
              <span class="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                {{ note.title || t('notes.untitled') }}
              </span>
            </div>
            <el-tooltip :content="t('notes.unpin')" placement="top">
              <button
                type="button"
                class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-rose-100 text-rose-500 transition hover:bg-rose-200 dark:bg-rose-500/20 dark:text-rose-300"
                @click="(e) => handleTogglePin(e, note)"
              >
                <el-icon :size="12"><Top /></el-icon>
              </button>
            </el-tooltip>
          </div>
          <p class="mt-1 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">
            {{ extractPreview(note.content) || '...' }}
          </p>
          <div class="mt-2 flex items-center justify-between text-[11px] text-slate-400">
            <span
              class="rounded px-1.5 py-0.5 font-mono text-[10px]"
              :class="
                note.format === 'markdown'
                  ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300'
                  : 'bg-slate-200/70 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
              "
            >
              {{ note.format === 'markdown' ? 'MD' : 'TXT' }}
            </span>
            <span>{{ formatRelativeTime(note.updatedAt, localeStore.locale) }}</span>
          </div>
        </div>
      </div>

      <!-- 普通笔记区 -->
      <div v-if="noteStore.regularNotes.length > 0" class="space-y-1.5">
        <div
          v-if="noteStore.pinnedNotes.length > 0"
          class="px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400"
        >
          {{ t('notes.normalSection') }}
        </div>

        <div
          v-for="note in noteStore.regularNotes"
          :key="note.id"
          draggable="true"
          class="group relative cursor-pointer rounded-xl border p-2.5 transition"
          :class="[
            noteStore.activeNoteId === note.id
              ? 'border-rose-300 bg-rose-50/70 shadow-xs dark:border-rose-500/50 dark:bg-rose-500/10'
              : 'border-slate-100 bg-white hover:border-slate-200 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700',
            draggingNoteId === note.id ? 'opacity-45' : '',
            dragOverNoteId === note.id && dragPosition === 'before'
              ? 'border-t-2 border-t-rose-500'
              : '',
            dragOverNoteId === note.id && dragPosition === 'after'
              ? 'border-b-2 border-b-rose-500'
              : ''
          ]"
          @click="handleSelectNote(note.id)"
          @dragstart="(e) => onDragStart(e, note)"
          @dragend="onDragEnd"
          @dragover="(e) => onDragOver(e, note)"
          @dragleave="dragOverNoteId = null"
          @drop="(e) => onDrop(e, note)"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="flex min-w-0 items-center gap-1.5">
              <el-icon class="shrink-0 cursor-grab text-slate-300 group-hover:text-slate-400">
                <Rank />
              </el-icon>
              <span class="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                {{ note.title || t('notes.untitled') }}
              </span>
            </div>
            <el-tooltip :content="t('notes.pin')" placement="top">
              <button
                type="button"
                class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-400 transition hover:bg-rose-50 hover:text-rose-500 md:hidden md:group-hover:flex dark:hover:bg-rose-500/15"
                @click="(e) => handleTogglePin(e, note)"
              >
                <el-icon :size="12"><Top /></el-icon>
              </button>
            </el-tooltip>
          </div>
          <p class="mt-1 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">
            {{ extractPreview(note.content) || '...' }}
          </p>
          <div class="mt-2 flex items-center justify-between text-[11px] text-slate-400">
            <span
              class="rounded px-1.5 py-0.5 font-mono text-[10px]"
              :class="
                note.format === 'markdown'
                  ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300'
                  : 'bg-slate-200/70 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
              "
            >
              {{ note.format === 'markdown' ? 'MD' : 'TXT' }}
            </span>
            <span>{{ formatRelativeTime(note.updatedAt, localeStore.locale) }}</span>
          </div>
        </div>
      </div>
    </div>

    <div
      class="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-400 dark:border-slate-800 dark:text-slate-500"
    >
      {{ t('notes.dragReorderTip') }}
    </div>
  </section>
</template>
