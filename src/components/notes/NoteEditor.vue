<script setup lang="ts">
import {
  ArrowLeft,
  Check,
  Clock,
  DArrowLeft,
  DArrowRight,
  Delete,
  Document,
  FullScreen,
  List,
  Picture,
  ScaleToOriginal,
  Share,
  Top,
  Upload,
  WarningFilled
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { notesApi } from '@/api/notes'
import { resolveApiErrorMessage } from '@/api/client'
import { useLayoutStore } from '@/stores/layout'
import { NoteConflictError, useNoteStore } from '@/stores/note'
import type { MarkdownViewMode, Note, NoteFormat } from '@/types'
import { extractMarkdownToc, type MarkdownTocItem, renderMarkdownSafe } from '@/utils/markdown'
import NoteConflictDialog, { type NoteConflictPayload } from './NoteConflictDialog.vue'
import NoteShareDialog from './NoteShareDialog.vue'
import TiptapEditor from './TiptapEditor.vue'
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
const viewMode = computed<MarkdownViewMode>({
  get: () => noteStore.markdownViewMode,
  set: (mode) => noteStore.setMarkdownViewMode(mode)
})
const isDraggingFile = ref(false)
const historyOpen = ref(false)
const shareDialogOpen = ref(false)
const hasActiveShare = ref(false)
const conflictDialogOpen = ref(false)
const conflictState = ref<NoteConflictPayload | null>(null)
const resolvingConflict = ref(false)
const conflictAutoSavePaused = ref(false)
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const tiptapRef = ref<InstanceType<typeof TiptapEditor> | null>(null)

// 跟踪当前编辑器加载展示的笔记 ID
const currentLoadedNoteId = ref<string | null>(null)

// 记录用户最后一次输入/编辑操作的时间戳
let lastInputTimestamp = 0

// 自动保存防抖计时器
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null

// 是否正在从 Store 进行全量初始化加载或切换笔记
let syncingFromStore = false

// 是否当前有网络保存请求在飞（in-flight）
const isSaving = ref(false)

// 当前正在飞行的保存请求 Promise
let inFlightSavePromise: Promise<Note | null> | null = null

// 正在飞行的保存请求发送的内容快照
interface SavingSnapshot {
  noteId: string
  title: string
  content: string
  format: NoteFormat
  expectedUpdatedAt: number
}
let inFlightSnapshot: SavingSnapshot | null = null

// 是否在保存等待期间产生了新的本地修改需要后续跟进保存（trailing save）
let hasPendingChanges = false

/**
 * 同步当前选中笔记数据到本地草稿状态
 * 核心优化：
 * 1. 仅在切换笔记（note.id 变化）或初次加载时重置草稿
 * 2. 同篇笔记在自动保存响应较慢时，绝不覆盖用户正在输入的本地草稿（标题/正文/格式）
 * 3. 仅同步文件夹等外部属性
 */
watch(
  () => noteStore.activeNote,
  (note, prevNote) => {
    // 1. 未选中笔记
    if (!note) {
      if (autoSaveTimer) {
        clearTimeout(autoSaveTimer)
        autoSaveTimer = null
      }
      currentLoadedNoteId.value = null
      hasPendingChanges = false
      hasActiveShare.value = false
      draftTitle.value = ''
      draftContent.value = ''
      conflictState.value = null
      conflictDialogOpen.value = false
      conflictAutoSavePaused.value = false
      if (layoutStore.isEditorFullscreen) {
        layoutStore.toggleEditorFullscreen(false)
      }
      return
    }

    // 2. 切换到不同笔记（或初次加载）
    if (note.id !== currentLoadedNoteId.value) {
      if (autoSaveTimer) {
        clearTimeout(autoSaveTimer)
        autoSaveTimer = null
      }
      currentLoadedNoteId.value = note.id
      hasPendingChanges = false
      conflictState.value = null
      conflictDialogOpen.value = false
      conflictAutoSavePaused.value = false

      syncingFromStore = true
      draftTitle.value = note.title
      draftContent.value = note.content
      draftFormat.value = note.format
      draftFolderId.value = note.folderId

      // 异步查询当前笔记的公开分享状态
      notesApi
        .getShare(note.id)
        .then((res) => {
          hasActiveShare.value = !!(
            res.share &&
            res.share.isEnabled &&
            (!res.share.expiresAt || res.share.expiresAt > Date.now())
          )
        })
        .catch(() => {
          hasActiveShare.value = false
        })

      setTimeout(() => {
        syncingFromStore = false
      }, 0)
      return
    }

    // 3. 同一篇笔记的状态更新（如慢保存响应完成返回、置顶变更等）
    // 仅同步文件夹等外部元数据，绝不覆盖用户正在打字的 draftTitle / draftContent / draftFormat
    if (draftFolderId.value !== note.folderId) {
      draftFolderId.value = note.folderId
    }
  },
  { immediate: true }
)

/** 监听外部主动触发的强制重置（如历史版本回退、冲突弹窗采用线上版本） */
watch(
  () => noteStore.forceSyncRevision,
  () => {
    const note = noteStore.activeNote
    if (!note) return
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer)
      autoSaveTimer = null
    }
    hasPendingChanges = false
    syncingFromStore = true
    draftTitle.value = note.title
    draftContent.value = note.content
    draftFormat.value = note.format
    draftFolderId.value = note.folderId
    setTimeout(() => {
      syncingFromStore = false
    }, 0)
  }
)

/** 全局按键监听：全屏模式下按 Esc 键快速退出（历史抽屉与冲突弹窗未打开时） */
function handleWindowKeydown(e: KeyboardEvent) {
  if (
    e.key === 'Escape' &&
    layoutStore.isEditorFullscreen &&
    !historyOpen.value &&
    !conflictDialogOpen.value
  ) {
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

// Markdown 纯预览模式下的目录状态与滚动定位
const previewContainerRef = ref<HTMLDivElement | null>(null)
const isTocCollapsed = ref(false)
const activeHeadingId = ref('')

const markdownToc = computed<MarkdownTocItem[]>(() => {
  if (draftFormat.value !== 'markdown') return []
  return extractMarkdownToc(draftContent.value)
})

/** 点击目录项平滑滚动至预览区对应的标题 */
function scrollToHeading(item: MarkdownTocItem) {
  activeHeadingId.value = item.id
  if (!previewContainerRef.value) return
  let el = previewContainerRef.value.querySelector<HTMLElement>(`#${item.id}`)
  if (!el) {
    const headings = previewContainerRef.value.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')
    el = headings[item.index] || null
    if (el) el.id = item.id
  }
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

/** 监听预览区滚动，动态高亮当前视口内的标题目录项 */
function handlePreviewScroll() {
  if (!previewContainerRef.value || markdownToc.value.length === 0) return
  const headings = Array.from(
    previewContainerRef.value.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')
  )
  if (headings.length === 0) return

  const containerTop = previewContainerRef.value.getBoundingClientRect().top
  let currentActiveId = headings[0].id || 'heading-0'
  for (const h of headings) {
    const rect = h.getBoundingClientRect()
    if (rect.top - containerTop <= 80) {
      currentActiveId = h.id
    } else {
      break
    }
  }
  if (currentActiveId) {
    activeHeadingId.value = currentActiveId
  }
}

watch(
  [renderedMarkdownHtml, viewMode],
  async () => {
    if (draftFormat.value !== 'markdown' || viewMode.value !== 'preview') return
    await nextTick()
    if (!previewContainerRef.value) return
    const headingEls = previewContainerRef.value.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')
    headingEls.forEach((el, index) => {
      el.id = `heading-${index}`
    })
    if (markdownToc.value.length > 0 && !markdownToc.value.some((h) => h.id === activeHeadingId.value)) {
      activeHeadingId.value = markdownToc.value[0].id
    }
  },
  { immediate: true }
)

const displayWordCount = computed(() => {
  if (draftFormat.value === 'markdown') {
    return draftContent.value.length
  }
  return draftContent.value.replace(/<[^>]+>/g, '').trim().length
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

/** 打开版本冲突对比弹窗，提示用户确认线上版本与本地草稿 */
function openConflictPrompt(noteId: string, serverNote: Note) {
  conflictState.value = {
    noteId,
    serverNote,
    localDraft: {
      title: draftTitle.value,
      content: draftContent.value,
      format: draftFormat.value
    }
  }
  conflictAutoSavePaused.value = true
  conflictDialogOpen.value = true
}

/** 重新打开已存在的冲突对比弹窗（刷新本地草稿快照） */
function reopenConflictPrompt() {
  if (!conflictState.value) return
  openConflictPrompt(conflictState.value.noteId, conflictState.value.serverNote)
}

/** 用户在冲突弹窗中确认覆盖保存：基于用户刚刚查看确认的线上版本号提交保存 */
async function handleConfirmConflictOverwrite() {
  if (!conflictState.value) return
  resolvingConflict.value = true
  try {
    draftTitle.value = conflictState.value.localDraft.title
    draftContent.value = conflictState.value.localDraft.content
    draftFormat.value = conflictState.value.localDraft.format
    await performSave({
      isManual: true,
      confirmConflict: true,
      expectedUpdatedAt: conflictState.value.serverNote.updatedAt
    })
    conflictState.value = null
    conflictDialogOpen.value = false
    conflictAutoSavePaused.value = false
    ElMessage.success(t('common.saved'))
  } catch (err) {
    if (err instanceof NoteConflictError) {
      // 在用户确认期间线上又发生了更新，刷新展示最新的线上版本再次等待用户确认
      openConflictPrompt(conflictState.value.noteId, err.serverNote)
    } else {
      ElMessage.error(resolveApiErrorMessage(err))
    }
  } finally {
    resolvingConflict.value = false
  }
}

/** 用户选择放弃本地冲突修改并采用线上最新版本 */
function handleUseServerVersion() {
  if (!conflictState.value) return
  const serverNote = conflictState.value.serverNote
  conflictState.value = null
  conflictDialogOpen.value = false
  conflictAutoSavePaused.value = false
  draftTitle.value = serverNote.title
  draftContent.value = serverNote.content
  draftFormat.value = serverNote.format
  draftFolderId.value = serverNote.folderId
  noteStore.applyServerNote(serverNote)
  ElMessage.success(t('common.success'))
}

/** 用户在冲突弹窗中直接编辑本地待保存版本时，实时同步冲突状态与编辑器草稿 */
function handleUpdateLocalDraft(nextDraft: NoteConflictPayload['localDraft']) {
  if (conflictState.value) {
    conflictState.value = {
      ...conflictState.value,
      localDraft: { ...nextDraft }
    }
  }
  draftTitle.value = nextDraft.title
  draftContent.value = nextDraft.content
  draftFormat.value = nextDraft.format
  if (noteStore.activeNote) {
    noteStore.recordLastEditedNote(noteStore.activeNote.id)
  }
}

/** 用户取消覆盖：关闭弹窗并保留本地编辑内容，暂停自动保存直至手动处理 */
function handleCancelConflictDialog() {
  conflictDialogOpen.value = false
  conflictAutoSavePaused.value = true
}

/** 处理标题或正文输入：立即记录最后编辑笔记 ID、最后输入时间戳并安排自动保存 */
function handleEditorInput() {
  lastInputTimestamp = Date.now()
  if (noteStore.activeNote) {
    noteStore.recordLastEditedNote(noteStore.activeNote.id)
  }
  scheduleAutoSave()
}

/**
 * 安排自动保存防抖
 * @param delayOverride 自定义防抖延迟（例如慢响应返回后若检测到用户在保存期间有新输入，快速跟进保存）
 */
function scheduleAutoSave(delayOverride?: number) {
  if (
    syncingFromStore ||
    !noteStore.activeNote ||
    conflictDialogOpen.value ||
    conflictAutoSavePaused.value
  ) {
    return
  }

  // 只要用户在输入，若当前已有保存请求在飞，标记待后续跟进保存
  if (isSaving.value) {
    hasPendingChanges = true
  }

  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer)
    autoSaveTimer = null
  }

  const delay = delayOverride !== undefined ? delayOverride : 1500

  noteStore.savingState = 'idle'
  autoSaveTimer = setTimeout(async () => {
    autoSaveTimer = null
    if (
      !noteStore.activeNote ||
      conflictDialogOpen.value ||
      conflictAutoSavePaused.value
    ) {
      return
    }
    try {
      await performSave({ isManual: false })
    } catch {
      // 错误已由 performSave 或 store 处理
    }
  }, delay)
}

/**
 * 核心保存调度器
 * 保证同一时刻只有一个保存请求在网络中（in-flight），
 * 当服务器响应慢时，期间用户的一切修改都被保存在本地草稿中，
 * 待慢响应返回并刷新最新 updatedAt 后，自动紧随其后发起下一次保存（trailing save），
 * 杜绝内容被覆盖和并发导致的 409 冲突。
 */
async function performSave(options: {
  isManual?: boolean
  confirmConflict?: boolean
  expectedUpdatedAt?: number
}): Promise<Note | null> {
  const note = noteStore.activeNote
  if (!note) return null

  // 如果冲突对话框已打开或暂停自动保存且不是确认冲突，则不保存
  if ((conflictDialogOpen.value || conflictAutoSavePaused.value) && !options.confirmConflict) {
    return null
  }

  // 如果当前已有保存请求在飞行中（in-flight）
  if (isSaving.value) {
    hasPendingChanges = true
    if (options.isManual && inFlightSavePromise) {
      // 用户主动手动保存（Ctrl+S 或点击保存按钮），等待当前慢请求完成
      await inFlightSavePromise
      // 当前慢请求完成后，如果仍有未保存的最新输入，接着保存最新内容
      if (hasUnsavedChanges.value || hasPendingChanges) {
        return performSave(options)
      }
      return noteStore.activeNote
    }
    return null
  }

  const targetId = note.id
  // 捕获本次发送的快照
  const snapshot: SavingSnapshot = {
    noteId: targetId,
    title: draftTitle.value,
    content: draftContent.value,
    format: draftFormat.value,
    expectedUpdatedAt: options.expectedUpdatedAt ?? note.updatedAt
  }

  isSaving.value = true
  inFlightSnapshot = snapshot
  hasPendingChanges = false

  const savePromise = (async () => {
    try {
      const updated = await noteStore.saveNote(targetId, {
        title: snapshot.title,
        content: snapshot.content,
        format: snapshot.format,
        changeType: options.isManual ? 'save' : 'auto_save',
        expectedUpdatedAt: snapshot.expectedUpdatedAt,
        confirmConflict: options.confirmConflict
      })

      // 保存成功！
      // 检查在保存等待期间，用户是否又输入了新的内容（且依然停留在当前笔记）
      if (noteStore.activeNote && noteStore.activeNote.id === targetId) {
        const draftChangedDuringSave =
          draftTitle.value !== snapshot.title ||
          draftContent.value !== snapshot.content ||
          draftFormat.value !== snapshot.format

        if (draftChangedDuringSave || hasPendingChanges) {
          // 用户在慢保存响应期间继续打字了！
          // 检查用户距离上一次打字停手的时间
          const elapsed = Date.now() - lastInputTimestamp
          if (elapsed >= 1500) {
            // 用户已经停手超过防抖时间，立即（50ms）跟进保存最新草稿
            scheduleAutoSave(50)
          } else {
            // 用户刚才还在打字，等待剩余防抖时间后再保存
            scheduleAutoSave(Math.max(50, 1500 - elapsed))
          }
        } else {
          hasPendingChanges = false
        }
      }

      return updated
    } catch (err) {
      if (err instanceof NoteConflictError) {
        openConflictPrompt(targetId, err.serverNote)
      }
      throw err
    } finally {
      isSaving.value = false
      inFlightSnapshot = null
      inFlightSavePromise = null
    }
  })()

  inFlightSavePromise = savePromise
  return savePromise
}

/** 立即执行手动保存并生成历史快照 */
async function handleManualSave() {
  const note = noteStore.activeNote
  if (!note) return
  noteStore.recordLastEditedNote(note.id)
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer)
    autoSaveTimer = null
  }
  try {
    await performSave({ isManual: true })
    conflictState.value = null
    conflictAutoSavePaused.value = false
    ElMessage.success(t('common.saved'))
  } catch (err) {
    if (err instanceof NoteConflictError) {
      openConflictPrompt(note.id, err.serverNote)
    } else {
      ElMessage.error(resolveApiErrorMessage(err))
    }
  }
}

async function handleFormatChange(format: NoteFormat) {
  if (format === draftFormat.value) return
  const note = noteStore.activeNote
  if (!note) return

  const confirmMsg =
    format === 'plain'
      ? t('notes.switchFormatToPlainConfirm')
      : t('notes.switchFormatToMarkdownConfirm')

  try {
    await ElMessageBox.confirm(
      confirmMsg,
      t('notes.switchFormatConfirmTitle'),
      {
        type: 'warning',
        confirmButtonText: t('common.confirm'),
        cancelButtonText: t('common.cancel')
      }
    )
  } catch (err) {
    if (err !== 'cancel' && err !== 'close') {
      ElMessage.error(resolveApiErrorMessage(err))
    }
    return
  }

  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer)
    autoSaveTimer = null
  }

  // 格式相互转换支持：从 Markdown 转为富文本时将语法渲染为标准 HTML 载入富文本
  if (format === 'plain' && draftFormat.value === 'markdown') {
    if (draftContent.value.trim()) {
      draftContent.value = renderMarkdownSafe(draftContent.value)
    }
  }

  draftFormat.value = format
  if (format === 'markdown' && viewMode.value === 'preview') {
    viewMode.value = 'split'
  }
  noteStore.recordLastEditedNote(note.id)
  try {
    await performSave({ isManual: true })
    conflictState.value = null
    conflictAutoSavePaused.value = false
  } catch (err) {
    if (err instanceof NoteConflictError) {
      openConflictPrompt(note.id, err.serverNote)
    } else {
      ElMessage.error(resolveApiErrorMessage(err))
    }
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
  lastInputTimestamp = Date.now()
  if (noteStore.activeNote) {
    noteStore.recordLastEditedNote(noteStore.activeNote.id)
  }
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
  lastInputTimestamp = Date.now()
  if (noteStore.activeNote) {
    noteStore.recordLastEditedNote(noteStore.activeNote.id)
  }
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
        tiptapRef.value?.insertImage(attachment.url, attachment.filename)
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
  if (draftFormat.value === 'markdown' && viewMode.value === 'preview') {
    return
  }
  if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
    e.preventDefault()
    uploadImageFiles(Array.from(e.dataTransfer.files))
  }
}

function handleDragOverFiles(e: DragEvent) {
  if (draftFormat.value === 'markdown' && viewMode.value === 'preview') {
    return
  }
  if (e.dataTransfer?.types.includes('Files')) {
    e.preventDefault()
    isDraggingFile.value = true
  }
}

function handlePaste(e: ClipboardEvent) {
  if (draftFormat.value === 'markdown' && viewMode.value === 'preview') {
    return
  }
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
              data-testid="format-switch-markdown"
              type="button"
              class="rounded-md px-2 py-1 text-xs transition sm:px-2.5"
              :class="
                draftFormat === 'markdown'
                  ? 'bg-white font-medium text-rose-600 shadow-xs dark:bg-slate-700 dark:text-rose-300'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
              "
              @click="handleFormatChange('markdown')"
            >
              {{ t('notes.formatMarkdown') }}
            </button>
            <button
              data-testid="format-switch-plain"
              type="button"
              class="rounded-md px-2 py-1 text-xs transition sm:px-2.5"
              :class="
                draftFormat === 'plain'
                  ? 'bg-white font-medium text-rose-600 shadow-xs dark:bg-slate-700 dark:text-rose-300'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
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
              :data-testid="`view-mode-${m.key}`"
              type="button"
              class="rounded-md px-2 py-1 text-xs transition"
              :class="
                viewMode === m.key
                  ? 'bg-white font-medium text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
              "
              @click="viewMode = m.key as MarkdownViewMode"
            >
              {{ m.label }}
            </button>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <span
            class="text-[11px] sm:text-xs"
            :class="
              noteStore.savingState === 'conflict'
                ? 'font-medium text-amber-600 dark:text-amber-400'
                : 'text-slate-400'
            "
          >
            <template v-if="noteStore.savingState === 'saving'">{{ t('common.saving') }}</template>
            <template v-else-if="noteStore.savingState === 'conflict'">{{
              t('notes.conflictBadge')
            }}</template>
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

          <!-- 分享笔记按钮 -->
          <el-tooltip :content="t('notes.shareBtn')" placement="top">
            <el-button
              data-testid="share-note-btn"
              size="small"
              :type="hasActiveShare ? 'primary' : 'default'"
              plain
              class="relative !m-0 !rounded-lg"
              :aria-label="t('notes.shareBtn')"
              @click="shareDialogOpen = true"
            >
              <el-icon class="lg:mr-1"><Share /></el-icon>
              <span class="hidden lg:inline">{{ t('shares.dialogTitle') }}</span>
              <span
                v-if="hasActiveShare"
                class="absolute -right-0.5 -top-0.5 flex h-2 w-2"
              >
                <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75"></span>
                <span class="relative inline-flex h-2 w-2 rounded-full bg-rose-500"></span>
              </span>
            </el-button>
          </el-tooltip>

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

          <el-button
            data-testid="save-note-btn"
            size="small"
            type="primary"
            class="!m-0 !rounded-lg"
            @click="handleManualSave"
          >
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

      <!-- 存在多设备版本冲突且用户暂未确认时的顶部提醒条 -->
      <div
        v-if="noteStore.savingState === 'conflict' && conflictState"
        data-testid="note-conflict-banner"
        class="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200/80 bg-amber-50/90 px-3 py-1.5 text-xs text-amber-800 sm:px-5 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
      >
        <div class="flex items-center gap-1.5">
          <el-icon class="shrink-0 text-amber-500"><WarningFilled /></el-icon>
          <span>{{ t('notes.conflictBannerText') }}</span>
        </div>
        <el-button
          data-testid="reopen-conflict-btn"
          size="small"
          type="warning"
          plain
          class="!rounded-lg"
          @click="reopenConflictPrompt"
        >
          {{ t('notes.conflictReviewBtn') }}
        </el-button>
      </div>

      <!-- 笔记标题栏 -->
      <div class="border-b border-slate-100 px-4 py-2.5 sm:px-6 sm:py-3 dark:border-slate-800/80">
        <input
          v-model="draftTitle"
          type="text"
          :placeholder="t('notes.titlePlaceholder')"
          maxlength="200"
          class="w-full bg-transparent text-lg font-bold text-slate-900 placeholder-slate-300 outline-none sm:text-xl dark:text-slate-100 dark:placeholder-slate-600"
          @input="handleEditorInput"
          @keydown="handleKeydown"
        />
      </div>

      <!-- 全局隐藏的文件选择输入框（供 Markdown 与富文本编辑器上传图片复用） -->
      <input
        ref="fileInputRef"
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        class="hidden"
        @change="handleFileInputChange"
      />

      <!-- Markdown 专属快捷编辑工具栏（普通文本笔记已由 Tiptap 富文本内置工具栏接管，不再展示此单独一行） -->
      <div
        v-if="draftFormat === 'markdown'"
        data-testid="markdown-toolbar"
        class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/60 px-3 py-1.5 sm:px-5 dark:border-slate-800 dark:bg-slate-900/60"
      >
        <div class="flex flex-wrap items-center gap-1">
          <template v-if="viewMode !== 'preview'">
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

            <button
              type="button"
              data-testid="markdown-upload-image-btn"
              class="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-rose-600 transition hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-500/15"
              @click="fileInputRef?.click()"
            >
              <el-icon><Picture /></el-icon>
              <span>{{
                noteStore.uploadingImage ? t('notes.uploadingImage') : t('notes.uploadImageBtn')
              }}</span>
            </button>
          </template>
        </div>

        <div class="text-[11px] text-slate-400">
          {{ t('notes.wordCount', { count: displayWordCount }) }}
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
          class="min-h-0 flex-1"
          :class="
            viewMode === 'split'
              ? 'grid grid-cols-1 grid-rows-2 md:grid-cols-2 md:grid-rows-1'
              : viewMode === 'edit'
                ? 'grid grid-cols-1'
                : 'flex flex-row overflow-hidden'
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
            @input="handleEditorInput"
            @paste="handlePaste"
            @keydown="handleKeydown"
          />

          <div
            v-if="viewMode === 'split' || viewMode === 'preview'"
            ref="previewContainerRef"
            class="candy-markdown-body min-h-0 h-full flex-1 overflow-y-auto p-4 text-slate-800 sm:p-6 dark:text-slate-200"
            v-html="renderedMarkdownHtml"
            @scroll.passive="handlePreviewScroll"
          />

          <!-- 纯预览模式下的右侧可折叠目录 (TOC) -->
          <aside
            v-if="viewMode === 'preview'"
            data-testid="markdown-toc-sidebar"
            class="relative shrink-0 border-l border-slate-200/80 bg-slate-50/70 transition-all duration-200 dark:border-slate-800 dark:bg-slate-900/50"
            :class="isTocCollapsed ? 'w-10' : 'w-60 md:w-64'"
          >
            <!-- 折叠状态下的侧边收起条 -->
            <div
              v-if="isTocCollapsed"
              class="flex h-full flex-col items-center py-3"
            >
              <el-tooltip :content="t('notes.expandToc')" placement="left">
                <button
                  type="button"
                  data-testid="expand-toc-btn"
                  class="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-200/70 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 cursor-pointer"
                  :title="t('notes.expandToc')"
                  @click="isTocCollapsed = false"
                >
                  <el-icon :size="16"><DArrowLeft /></el-icon>
                </button>
              </el-tooltip>
              <button
                type="button"
                data-testid="expand-toc-text-btn"
                class="mt-3 text-[11px] font-medium text-slate-400 hover:text-rose-500 transition [writing-mode:vertical-rl] tracking-widest select-none cursor-pointer"
                :title="t('notes.expandToc')"
                @click="isTocCollapsed = false"
              >
                {{ t('notes.tocTitle') }}
              </button>
            </div>

            <!-- 展开状态下的目录面板 -->
            <div
              v-else
              class="flex h-full flex-col min-h-0 p-3.5"
            >
              <div class="flex items-center justify-between pb-2.5 border-b border-slate-200/70 dark:border-slate-800">
                <div class="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                  <el-icon class="text-rose-500"><List /></el-icon>
                  <span>{{ t('notes.tocTitle') }}</span>
                  <span v-if="markdownToc.length > 0" class="text-[10px] font-normal text-slate-400">
                    ({{ markdownToc.length }})
                  </span>
                </div>
                <el-tooltip :content="t('notes.collapseToc')" placement="left">
                  <button
                    type="button"
                    data-testid="collapse-toc-btn"
                    class="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-200/70 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 cursor-pointer"
                    :title="t('notes.collapseToc')"
                    @click="isTocCollapsed = true"
                  >
                    <el-icon :size="14"><DArrowRight /></el-icon>
                  </button>
                </el-tooltip>
              </div>

              <!-- 目录为空提示 -->
              <div
                v-if="markdownToc.length === 0"
                class="flex flex-1 items-center justify-center text-center text-xs text-slate-400"
              >
                {{ t('notes.tocEmpty') }}
              </div>

              <!-- 目录条目导航 -->
              <nav
                v-else
                class="flex-1 overflow-y-auto pt-2 space-y-0.5 text-xs pr-1"
              >
                <button
                  v-for="item in markdownToc"
                  :key="item.id"
                  :data-testid="`toc-item-${item.id}`"
                  type="button"
                  class="group flex w-full items-center text-left rounded-md px-2 py-1.5 transition text-xs cursor-pointer"
                  :class="[
                    item.level === 1 ? 'font-medium' : '',
                    item.level === 2 ? 'pl-4' : '',
                    item.level === 3 ? 'pl-7 text-[11px]' : '',
                    item.level >= 4 ? 'pl-9 text-[11px]' : '',
                    activeHeadingId === item.id
                      ? 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300 font-medium'
                      : 'text-slate-600 hover:bg-slate-200/60 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200'
                  ]"
                  @click="scrollToHeading(item)"
                >
                  <span class="truncate">{{ item.text }}</span>
                </button>
              </nav>
            </div>
          </aside>
        </div>

        <!-- Tiptap 富文本编辑器（替代原普通文本 textarea） -->
        <tiptap-editor
          v-else
          ref="tiptapRef"
          v-model="draftContent"
          :placeholder="t('notes.contentPlaceholderPlain')"
          @input="handleEditorInput"
          @upload-image-request="fileInputRef?.click()"
          @drop-files="uploadImageFiles"
          @paste-files="uploadImageFiles"
        />
      </div>

      <!-- 一周内历史版本回退抽屉 -->
      <VersionHistoryDrawer
        v-model="historyOpen"
        :note-id="noteStore.activeNote.id"
        :current-title="draftTitle"
        :current-content="draftContent"
      />

      <!-- 多设备编辑版本冲突对比确认弹窗 -->
      <NoteConflictDialog
        v-model="conflictDialogOpen"
        :conflict="conflictState"
        :submitting="resolvingConflict"
        @update:local-draft="handleUpdateLocalDraft"
        @confirm-overwrite="handleConfirmConflictOverwrite"
        @use-server="handleUseServerVersion"
        @cancel="handleCancelConflictDialog"
      />

      <!-- 笔记公开分享配置弹窗 -->
      <NoteShareDialog
        v-model="shareDialogOpen"
        :note="noteStore.activeNote"
        @share-updated="(share) => {
          hasActiveShare = !!(
            share &&
            share.isEnabled &&
            (!share.expiresAt || share.expiresAt > Date.now())
          )
        }"
      />
    </template>
  </main>
</template>
