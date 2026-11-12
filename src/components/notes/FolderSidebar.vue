<script setup lang="ts">
import {
  Delete,
  Edit,
  Folder as FolderIcon,
  FolderAdd,
  FolderOpened,
  MoreFilled,
  Tickets
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { resolveApiErrorMessage } from '@/api/client'
import { useNoteStore } from '@/stores/note'
import type { Folder } from '@/types'

/**
 * 文件夹管理侧边栏组件
 * - 支持全部笔记、未分类视图切换
 * - 支持多级文件夹创建、重命名、删除
 * - 支持文件夹自身任意拖动排序
 * - 支持将笔记列表中的笔记拖入目标文件夹或未分类区域
 */
const { t } = useI18n()
const noteStore = useNoteStore()

const folderDialogVisible = ref(false)
const folderDialogMode = ref<'create' | 'rename'>('create')
const editingFolderId = ref<string | null>(null)
const parentFolderId = ref<string | null>(null)
const folderNameInput = ref('')
const submitting = ref(false)

/** 当前正在被拖动的文件夹 ID */
const draggingFolderId = ref<string | null>(null)
/** 高亮显示拖放目标文件夹及方向 */
const dropTargetId = ref<string | null>(null)
const dropPosition = ref<'before' | 'after' | 'into' | null>(null)

function openCreateFolder(parentId: string | null = null) {
  folderDialogMode.value = 'create'
  editingFolderId.value = null
  parentFolderId.value = parentId
  folderNameInput.value = ''
  folderDialogVisible.value = true
}

function openRenameFolder(folder: Folder) {
  folderDialogMode.value = 'rename'
  editingFolderId.value = folder.id
  parentFolderId.value = folder.parentId
  folderNameInput.value = folder.name
  folderDialogVisible.value = true
}

async function submitFolderDialog() {
  const name = folderNameInput.value.trim()
  if (!name) return
  submitting.value = true
  try {
    if (folderDialogMode.value === 'create') {
      await noteStore.createFolder(name, parentFolderId.value)
    } else if (editingFolderId.value) {
      await noteStore.renameFolder(editingFolderId.value, name)
    }
    folderDialogVisible.value = false
    ElMessage.success(t('common.success'))
  } catch (err) {
    ElMessage.error(resolveApiErrorMessage(err))
  } finally {
    submitting.value = false
  }
}

async function handleDeleteFolder(folder: Folder) {
  try {
    await ElMessageBox.confirm(
      t('folders.deleteConfirm', { name: folder.name }),
      t('folders.deleteTitle'),
      {
        type: 'warning',
        confirmButtonText: t('common.delete'),
        cancelButtonText: t('common.cancel')
      }
    )
    await noteStore.deleteFolder(folder.id)
    ElMessage.success(t('common.success'))
  } catch (err) {
    if (err !== 'cancel' && err !== 'close') {
      ElMessage.error(resolveApiErrorMessage(err))
    }
  }
}

function handleFolderDragStart(e: DragEvent, folderId: string) {
  draggingFolderId.value = folderId
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('application/x-candy-folder-id', folderId)
  }
}

function handleFolderDragEnd() {
  draggingFolderId.value = null
  dropTargetId.value = null
  dropPosition.value = null
}

function handleFolderDragOver(e: DragEvent, targetId: string) {
  const types = e.dataTransfer?.types ?? []
  const isNoteDrag = types.includes('application/x-candy-note-id')
  const isFolderDrag = types.includes('application/x-candy-folder-id')

  if (!isNoteDrag && !isFolderDrag) return
  e.preventDefault()

  dropTargetId.value = targetId
  if (isNoteDrag || targetId === 'uncategorized') {
    dropPosition.value = 'into'
    return
  }

  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const offsetY = e.clientY - rect.top
  dropPosition.value = offsetY < rect.height / 2 ? 'before' : 'after'
}

async function handleFolderDrop(e: DragEvent, targetId: string | 'uncategorized') {
  e.preventDefault()
  const noteId = e.dataTransfer?.getData('application/x-candy-note-id')
  const folderId = e.dataTransfer?.getData('application/x-candy-folder-id')
  const pos = dropPosition.value

  dropTargetId.value = null
  dropPosition.value = null
  draggingFolderId.value = null

  try {
    if (noteId) {
      const targetFolderId = targetId === 'uncategorized' ? null : targetId
      await noteStore.moveNoteToFolder(noteId, targetFolderId)
      if (targetFolderId === null) {
        ElMessage.success(t('folders.moveToRoot'))
      } else {
        const folder = noteStore.folders.find((f) => f.id === targetFolderId)
        ElMessage.success(t('folders.moveSuccess', { name: folder?.name || '' }))
      }
      return
    }

    if (folderId && targetId !== 'uncategorized' && folderId !== targetId) {
      await noteStore.reorderFolders(folderId, targetId, pos === 'after' ? 'after' : 'before')
    }
  } catch (err) {
    ElMessage.error(resolveApiErrorMessage(err))
  }
}
</script>

<template>
  <aside
    class="flex h-full w-60 shrink-0 flex-col border-r border-slate-200/80 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900/50"
  >
    <div class="flex items-center justify-between px-3.5 pt-3.5 pb-2">
      <span class="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
        {{ t('folders.title') }}
      </span>
      <el-tooltip :content="t('folders.newFolder')" placement="top">
        <button
          type="button"
          class="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 transition hover:bg-rose-50 hover:text-rose-500 dark:text-slate-400 dark:hover:bg-rose-500/10"
          @click="openCreateFolder(null)"
        >
          <el-icon><FolderAdd /></el-icon>
        </button>
      </el-tooltip>
    </div>

    <div class="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
      <!-- 全部笔记 -->
      <button
        type="button"
        class="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition"
        :class="
          noteStore.activeFolderId === 'all'
            ? 'bg-rose-50 font-medium text-rose-600 dark:bg-rose-500/15 dark:text-rose-300'
            : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/80'
        "
        @click="noteStore.selectFolder('all')"
      >
        <span class="flex items-center gap-2 truncate">
          <el-icon><Tickets /></el-icon>
          <span class="truncate">{{ t('folders.allNotes') }}</span>
        </span>
        <span class="text-xs text-slate-400">{{ noteStore.noteCountMap.total }}</span>
      </button>

      <!-- 未分类笔记（支持拖入笔记取消文件夹归属） -->
      <button
        type="button"
        class="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition"
        :class="[
          noteStore.activeFolderId === 'uncategorized'
            ? 'bg-rose-50 font-medium text-rose-600 dark:bg-rose-500/15 dark:text-rose-300'
            : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/80',
          dropTargetId === 'uncategorized' ? 'ring-2 ring-rose-400 bg-rose-50/80 dark:bg-rose-500/20' : ''
        ]"
        @click="noteStore.selectFolder('uncategorized')"
        @dragover="(e) => handleFolderDragOver(e, 'uncategorized')"
        @dragleave="dropTargetId = null"
        @drop="(e) => handleFolderDrop(e, 'uncategorized')"
      >
        <span class="flex items-center gap-2 truncate">
          <el-icon><FolderOpened /></el-icon>
          <span class="truncate">{{ t('folders.uncategorized') }}</span>
        </span>
        <span class="text-xs text-slate-400">{{ noteStore.noteCountMap.uncategorized }}</span>
      </button>

      <div class="my-2 border-t border-slate-200/70 dark:border-slate-800" />

      <!-- 用户自定义文件夹树（支持拖动排序与拖入笔记） -->
      <div v-if="noteStore.orderedFolders.length === 0" class="px-3 py-4 text-xs text-slate-400">
        {{ t('folders.empty') }}
      </div>

      <div
        v-for="folder in noteStore.orderedFolders"
        :key="folder.id"
        draggable="true"
        class="group relative flex items-center justify-between rounded-xl py-1.5 pr-2 text-sm transition cursor-grab active:cursor-grabbing"
        :style="{ paddingLeft: `${12 + folder.depth * 14}px` }"
        :class="[
          noteStore.activeFolderId === folder.id
            ? 'bg-rose-50 font-medium text-rose-600 dark:bg-rose-500/15 dark:text-rose-300'
            : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/80',
          draggingFolderId === folder.id ? 'opacity-50' : '',
          dropTargetId === folder.id && dropPosition === 'into'
            ? 'ring-2 ring-rose-400 bg-rose-50/70 dark:bg-rose-500/20'
            : '',
          dropTargetId === folder.id && dropPosition === 'before'
            ? 'border-t-2 border-rose-500'
            : '',
          dropTargetId === folder.id && dropPosition === 'after'
            ? 'border-b-2 border-rose-500'
            : ''
        ]"
        @click="noteStore.selectFolder(folder.id)"
        @dragstart="(e) => handleFolderDragStart(e, folder.id)"
        @dragend="handleFolderDragEnd"
        @dragover="(e) => handleFolderDragOver(e, folder.id)"
        @dragleave="dropTargetId = null"
        @drop="(e) => handleFolderDrop(e, folder.id)"
      >
        <div class="flex min-w-0 flex-1 items-center gap-2">
          <el-icon class="shrink-0 text-amber-500"><FolderIcon /></el-icon>
          <span class="truncate">{{ folder.name }}</span>
        </div>

        <div class="flex items-center gap-1">
          <span class="text-xs text-slate-400 group-hover:hidden">
            {{ noteStore.noteCountMap.map.get(folder.id) ?? 0 }}
          </span>
          <el-dropdown trigger="click" @click.stop>
            <button
              type="button"
              class="hidden h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-200/80 hover:text-slate-700 group-hover:flex dark:hover:bg-slate-700 dark:hover:text-slate-200"
              @click.stop
            >
              <el-icon :size="13"><MoreFilled /></el-icon>
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="openCreateFolder(folder.id)">
                  <el-icon><FolderAdd /></el-icon>
                  <span>{{ t('folders.newSubfolder') }}</span>
                </el-dropdown-item>
                <el-dropdown-item @click="openRenameFolder(folder)">
                  <el-icon><Edit /></el-icon>
                  <span>{{ t('common.rename') }}</span>
                </el-dropdown-item>
                <el-dropdown-item divided @click="handleDeleteFolder(folder)">
                  <el-icon class="text-rose-500"><Delete /></el-icon>
                  <span class="text-rose-500">{{ t('common.delete') }}</span>
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>
    </div>

    <div
      class="border-t border-slate-200/70 px-3.5 py-2.5 text-[11px] leading-relaxed text-slate-400 dark:border-slate-800 dark:text-slate-500"
    >
      {{ t('folders.dragTip') }}
    </div>

    <!-- 新建/重命名文件夹弹窗 -->
    <el-dialog
      v-model="folderDialogVisible"
      :title="folderDialogMode === 'create' ? t('folders.newFolder') : t('folders.renameTitle')"
      width="380px"
      append-to-body
    >
      <el-form @submit.prevent="submitFolderDialog">
        <el-input
          v-model="folderNameInput"
          :placeholder="t('folders.folderNamePlaceholder')"
          maxlength="60"
          autofocus
        />
      </el-form>
      <template #footer>
        <el-button @click="folderDialogVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="submitting" @click="submitFolderDialog">
          {{ t('common.confirm') }}
        </el-button>
      </template>
    </el-dialog>
  </aside>
</template>
