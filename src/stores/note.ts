import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { filesApi } from '@/api/files'
import { foldersApi } from '@/api/folders'
import { notesApi } from '@/api/notes'
import { useAuthStore } from '@/stores/auth'
import type { Attachment, Folder, MarkdownViewMode, Note, NoteFormat, NoteVersion } from '@/types'
import { buildSortPayload, reorderListById } from '@/utils/reorder'

const EDITOR_STATE_STORAGE_PREFIX = 'candy_note_editor_state'

/** 本地持久化的最后编辑笔记与 Markdown 视图模式状态 */
export interface PersistedEditorState {
  noteId: string | null
  markdownViewMode: MarkdownViewMode
}

function isValidMarkdownViewMode(value: unknown): value is MarkdownViewMode {
  return value === 'split' || value === 'edit' || value === 'preview'
}

export function getEditorStateStorageKey(userId?: string | null): string {
  return userId ? `${EDITOR_STATE_STORAGE_PREFIX}:${userId}` : EDITOR_STATE_STORAGE_PREFIX
}

function readPersistedEditorState(userId?: string | null): PersistedEditorState {
  const fallback: PersistedEditorState = { noteId: null, markdownViewMode: 'split' }
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  try {
    const raw = window.localStorage.getItem(getEditorStateStorageKey(userId))
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Record<string, unknown> | null
    if (!parsed || typeof parsed !== 'object') return fallback
    return {
      noteId: typeof parsed.noteId === 'string' && parsed.noteId.length > 0 ? parsed.noteId : null,
      markdownViewMode: isValidMarkdownViewMode(parsed.markdownViewMode)
        ? parsed.markdownViewMode
        : 'split'
    }
  } catch {
    return fallback
  }
}

function writePersistedEditorState(state: PersistedEditorState, userId?: string | null): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  try {
    window.localStorage.setItem(getEditorStateStorageKey(userId), JSON.stringify(state))
  } catch {
    // 忽略浏览器隐私模式或 localStorage 存储配额异常
  }
}

/** 带树形深度的扁平文件夹展示项 */
export interface FolderTreeItem extends Folder {
  depth: number
}

/**
 * 云笔记工作区核心状态仓库
 * 管理文件夹、笔记列表、置顶排序、拖动排序、R2 图片附件、一周历史版本回退及最后编辑状态本地持久化
 */
export const useNoteStore = defineStore('note', () => {
  const authStore = useAuthStore()

  function getCurrentUserId(): string | null {
    return authStore.user?.id ?? null
  }

  const folders = ref<Folder[]>([])
  const allNotes = ref<Note[]>([])
  const activeFolderId = ref<string>('all')
  const activeNoteId = ref<string | null>(null)
  const markdownViewMode = ref<MarkdownViewMode>(
    readPersistedEditorState(getCurrentUserId()).markdownViewMode
  )
  const searchQuery = ref<string>('')
  const formatFilter = ref<'all' | NoteFormat>('all')
  const versions = ref<NoteVersion[]>([])
  const attachments = ref<Attachment[]>([])
  const loading = ref(false)
  const savingState = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const uploadingImage = ref(false)

  /** 持久化最后编辑的笔记 ID 与 Markdown 视图模式到 localStorage */
  function persistEditorState(
    noteId: string | null,
    mode: MarkdownViewMode = markdownViewMode.value
  ) {
    writePersistedEditorState(
      {
        noteId,
        markdownViewMode: isValidMarkdownViewMode(mode) ? mode : 'split'
      },
      getCurrentUserId()
    )
  }

  /** 仅记录最后一次编辑/打开的笔记 ID（保留当前 Markdown 编辑视图状态） */
  function recordLastEditedNote(noteId: string) {
    if (!noteId) return
    persistEditorState(noteId, markdownViewMode.value)
  }

  /** 设置 Markdown 笔记编辑视图状态（边写边预览 / 纯编辑 / 纯预览）并持久化 */
  function setMarkdownViewMode(mode: MarkdownViewMode) {
    const safeMode: MarkdownViewMode = isValidMarkdownViewMode(mode) ? mode : 'split'
    markdownViewMode.value = safeMode
    const targetNoteId =
      activeNoteId.value ?? readPersistedEditorState(getCurrentUserId()).noteId
    persistEditorState(targetNoteId, safeMode)
  }

  /** 当前选中的笔记对象 */
  const activeNote = computed(
    () => allNotes.value.find((n) => n.id === activeNoteId.value) ?? null
  )

  /** 按所属文件夹、搜索词与格式筛选后的有序笔记集合 */
  const filteredNotes = computed(() => {
    const q = searchQuery.value.trim().toLowerCase()
    return allNotes.value
      .filter((note) => {
        if (activeFolderId.value === 'uncategorized') {
          if (note.folderId !== null) return false
        } else if (activeFolderId.value !== 'all') {
          if (note.folderId !== activeFolderId.value) return false
        }
        if (formatFilter.value !== 'all' && note.format !== formatFilter.value) {
          return false
        }
        if (q) {
          const hitTitle = note.title.toLowerCase().includes(q)
          const hitContent = note.content.toLowerCase().includes(q)
          if (!hitTitle && !hitContent) return false
        }
        return true
      })
      .sort((a, b) => {
        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
        return b.updatedAt - a.updatedAt
      })
  })

  /** 当前筛选结果中的置顶笔记 */
  const pinnedNotes = computed(() => filteredNotes.value.filter((n) => n.isPinned))

  /** 当前筛选结果中的普通笔记 */
  const regularNotes = computed(() => filteredNotes.value.filter((n) => !n.isPinned))

  /** 统计每个文件夹内的笔记数量 */
  const noteCountMap = computed(() => {
    const map = new Map<string, number>()
    let uncategorized = 0
    for (const note of allNotes.value) {
      if (note.folderId) {
        map.set(note.folderId, (map.get(note.folderId) ?? 0) + 1)
      } else {
        uncategorized++
      }
    }
    return { map, uncategorized, total: allNotes.value.length }
  })

  /** 将扁平文件夹按 sortOrder 构造带缩进深度的有序展示列表 */
  const orderedFolders = computed<FolderTreeItem[]>(() => {
    const sorted = [...folders.value].sort((a, b) =>
      a.sortOrder !== b.sortOrder ? a.sortOrder - b.sortOrder : a.createdAt - b.createdAt
    )
    const byParent = new Map<string | null, Folder[]>()
    for (const f of sorted) {
      const key = f.parentId ?? null
      const list = byParent.get(key) ?? []
      list.push(f)
      byParent.set(key, list)
    }

    const result: FolderTreeItem[] = []
    const visited = new Set<string>()
    function walk(parentId: string | null, depth: number) {
      const children = byParent.get(parentId) ?? []
      for (const child of children) {
        if (visited.has(child.id)) continue
        visited.add(child.id)
        result.push({ ...child, depth })
        walk(child.id, depth + 1)
      }
    }
    walk(null, 0)
    // 兜底：若存在孤立节点，确保不遗漏展示
    for (const f of sorted) {
      if (!visited.has(f.id)) {
        result.push({ ...f, depth: 0 })
      }
    }
    return result
  })

  /** 初始化加载所有文件夹与笔记（优先恢复上次记录的笔记与 Markdown 视图状态） */
  async function loadWorkspace() {
    loading.value = true
    try {
      const [folderRes, noteRes] = await Promise.all([foldersApi.list(), notesApi.list()])
      folders.value = folderRes.folders
      allNotes.value = noteRes.notes

      const persisted = readPersistedEditorState(getCurrentUserId())
      markdownViewMode.value = persisted.markdownViewMode

      if (activeNoteId.value && !allNotes.value.some((n) => n.id === activeNoteId.value)) {
        activeNoteId.value = null
      }
      if (!activeNoteId.value) {
        if (filteredNotes.value.length > 0) {
          const restored = persisted.noteId
            ? filteredNotes.value.find((n) => n.id === persisted.noteId)
            : undefined
          if (restored) {
            await selectNote(restored.id, { persist: false })
          } else {
            if (persisted.noteId && !allNotes.value.some((n) => n.id === persisted.noteId)) {
              persistEditorState(null, persisted.markdownViewMode)
            }
            await selectNote(filteredNotes.value[0].id, { persist: false })
          }
        } else if (persisted.noteId && !allNotes.value.some((n) => n.id === persisted.noteId)) {
          persistEditorState(null, persisted.markdownViewMode)
        }
      } else {
        await loadAttachments(activeNoteId.value)
      }
    } finally {
      loading.value = false
    }
  }

  /** 切换当前文件夹视图 */
  async function selectFolder(folderId: string) {
    activeFolderId.value = folderId
    if (
      activeNoteId.value &&
      !filteredNotes.value.some((n) => n.id === activeNoteId.value)
    ) {
      const first = filteredNotes.value[0]
      if (first) {
        await selectNote(first.id, { persist: false })
      } else {
        activeNoteId.value = null
        attachments.value = []
      }
    }
  }

  /** 选中笔记并加载其关联 R2 图片附件 */
  async function selectNote(noteId: string | null, options: { persist?: boolean } = {}) {
    const { persist = true } = options
    activeNoteId.value = noteId
    if (!noteId) {
      attachments.value = []
      versions.value = []
      if (persist) {
        persistEditorState(null, markdownViewMode.value)
      }
      return
    }
    if (persist) {
      persistEditorState(noteId, markdownViewMode.value)
    }
    await loadAttachments(noteId)
  }

  /** 加载指定笔记关联的 R2 附件列表 */
  async function loadAttachments(noteId: string) {
    try {
      const res = await filesApi.listByNote(noteId)
      if (activeNoteId.value === noteId) {
        attachments.value = res.attachments
      }
    } catch {
      attachments.value = []
    }
  }

  /** 新建文件夹 */
  async function createFolder(name: string, parentId: string | null = null) {
    const res = await foldersApi.create({ name, parentId })
    folders.value.push(res.folder)
    return res.folder
  }

  /** 重命名文件夹 */
  async function renameFolder(id: string, name: string) {
    const res = await foldersApi.update(id, { name })
    const idx = folders.value.findIndex((f) => f.id === id)
    if (idx !== -1) folders.value[idx] = res.folder
    return res.folder
  }

  /** 删除文件夹（后端会安全地将内部笔记移至未分类） */
  async function deleteFolder(id: string) {
    const res = await foldersApi.remove(id)
    const deletedSet = new Set(res.deletedIds)
    folders.value = folders.value.filter((f) => !deletedSet.has(f.id))
    allNotes.value = allNotes.value.map((n) =>
      n.folderId && deletedSet.has(n.folderId) ? { ...n, folderId: null } : n
    )
    if (deletedSet.has(activeFolderId.value)) {
      activeFolderId.value = 'all'
    }
  }

  /** 拖动排序文件夹并持久化到服务端 */
  async function reorderFolders(
    draggedId: string,
    targetId: string,
    position: 'before' | 'after' = 'before'
  ) {
    const dragged = folders.value.find((f) => f.id === draggedId)
    const target = folders.value.find((f) => f.id === targetId)
    if (!dragged || !target || draggedId === targetId) return

    const reordered = reorderListById(orderedFolders.value, draggedId, targetId, position)
    const payload = reordered.map((item, idx) => ({
      id: item.id,
      sortOrder: idx,
      parentId: item.id === draggedId ? target.parentId : item.parentId
    }))

    // 乐观更新本地顺序
    const orderMap = new Map(payload.map((p) => [p.id, p]))
    folders.value = folders.value.map((f) => {
      const patch = orderMap.get(f.id)
      return patch ? { ...f, sortOrder: patch.sortOrder, parentId: patch.parentId } : f
    })

    await foldersApi.reorder(payload)
  }

  /** 新建笔记 */
  async function createNote(format: NoteFormat, folderIdOverride?: string | null) {
    const resolvedFolderId =
      folderIdOverride !== undefined
        ? folderIdOverride
        : activeFolderId.value !== 'all' && activeFolderId.value !== 'uncategorized'
          ? activeFolderId.value
          : null

    const res = await notesApi.create({
      title: '',
      content: '',
      format,
      folderId: resolvedFolderId
    })
    allNotes.value.unshift(res.note)
    if (format === 'markdown' && markdownViewMode.value === 'preview') {
      markdownViewMode.value = 'split'
    }
    await selectNote(res.note.id)
    savingState.value = 'saved'
    return res.note
  }

  /** 保存笔记更新（支持手动保存与自动保存） */
  async function saveNote(
    id: string,
    patch: {
      title?: string
      content?: string
      format?: NoteFormat
      folderId?: string | null
      isPinned?: boolean
      changeType?: 'save' | 'auto_save'
    }
  ) {
    savingState.value = 'saving'
    try {
      const res = await notesApi.update(id, patch)
      const idx = allNotes.value.findIndex((n) => n.id === id)
      if (idx !== -1) {
        allNotes.value[idx] = res.note
      }
      if (
        activeNoteId.value === id ||
        patch.title !== undefined ||
        patch.content !== undefined ||
        patch.format !== undefined
      ) {
        persistEditorState(id, markdownViewMode.value)
      }
      savingState.value = 'saved'
      return res.note
    } catch (err) {
      savingState.value = 'error'
      throw err
    }
  }

  /** 切换笔记置顶状态 */
  async function togglePin(note: Note) {
    return saveNote(note.id, { isPinned: !note.isPinned })
  }

  /** 将笔记拖入指定文件夹或移至未分类 */
  async function moveNoteToFolder(noteId: string, folderId: string | null) {
    return saveNote(noteId, { folderId })
  }

  /** 拖动排序笔记（在同置顶分组内任意拖动排序，并批量同步至服务端） */
  async function reorderNotes(
    draggedId: string,
    targetId: string,
    position: 'before' | 'after' = 'before'
  ) {
    const dragged = allNotes.value.find((n) => n.id === draggedId)
    const target = allNotes.value.find((n) => n.id === targetId)
    if (!dragged || !target || draggedId === targetId) return

    // 保证置顶笔记与普通笔记分别在各自区域内拖动排序
    if (dragged.isPinned !== target.isPinned) return

    const group = (dragged.isPinned ? pinnedNotes.value : regularNotes.value).slice()
    const reordered = reorderListById(group, draggedId, targetId, position)
    const baseOffset = dragged.isPinned ? 0 : 10000
    const payload = buildSortPayload(reordered, baseOffset)

    const orderMap = new Map(payload.map((p) => [p.id, p.sortOrder]))
    allNotes.value = allNotes.value.map((n) =>
      orderMap.has(n.id) ? { ...n, sortOrder: orderMap.get(n.id)! } : n
    )

    await notesApi.reorder(payload)
  }

  /** 删除笔记 */
  async function deleteNote(id: string) {
    await notesApi.remove(id)
    allNotes.value = allNotes.value.filter((n) => n.id !== id)
    if (activeNoteId.value === id) {
      const next = filteredNotes.value[0]
      await selectNote(next ? next.id : null)
    } else if (readPersistedEditorState(getCurrentUserId()).noteId === id) {
      persistEditorState(activeNoteId.value, markdownViewMode.value)
    }
  }

  /** 加载笔记最近一周内的历史版本 */
  async function loadVersions(noteId: string) {
    const res = await notesApi.listVersions(noteId)
    versions.value = res.versions
    return res.versions
  }

  /** 回退到指定历史版本 */
  async function rollbackVersion(noteId: string, versionId: string) {
    const res = await notesApi.rollbackVersion(noteId, versionId)
    const idx = allNotes.value.findIndex((n) => n.id === noteId)
    if (idx !== -1) {
      allNotes.value[idx] = res.note
    }
    if (activeNoteId.value === noteId) {
      persistEditorState(noteId, markdownViewMode.value)
    }
    await loadVersions(noteId)
    return res.note
  }

  /** 上传图片至 Cloudflare R2 */
  async function uploadImage(file: File, noteId: string | null) {
    uploadingImage.value = true
    try {
      const res = await filesApi.upload(file, noteId)
      if (noteId && activeNoteId.value === noteId) {
        attachments.value.unshift(res.attachment)
        persistEditorState(noteId, markdownViewMode.value)
      }
      return res.attachment
    } finally {
      uploadingImage.value = false
    }
  }

  /** 删除 R2 图片附件 */
  async function deleteAttachment(attachmentId: string) {
    await filesApi.remove(attachmentId)
    attachments.value = attachments.value.filter((a) => a.id !== attachmentId)
  }

  /** 清空工作区状态（退出登录时调用） */
  function reset() {
    folders.value = []
    allNotes.value = []
    activeFolderId.value = 'all'
    activeNoteId.value = null
    markdownViewMode.value = 'split'
    searchQuery.value = ''
    formatFilter.value = 'all'
    versions.value = []
    attachments.value = []
    savingState.value = 'idle'
  }

  return {
    folders,
    allNotes,
    activeFolderId,
    activeNoteId,
    markdownViewMode,
    searchQuery,
    formatFilter,
    versions,
    attachments,
    loading,
    savingState,
    uploadingImage,
    activeNote,
    filteredNotes,
    pinnedNotes,
    regularNotes,
    noteCountMap,
    orderedFolders,
    loadWorkspace,
    selectFolder,
    selectNote,
    setMarkdownViewMode,
    recordLastEditedNote,
    loadAttachments,
    createFolder,
    renameFolder,
    deleteFolder,
    reorderFolders,
    createNote,
    saveNote,
    togglePin,
    moveNoteToFolder,
    reorderNotes,
    deleteNote,
    loadVersions,
    rollbackVersion,
    uploadImage,
    deleteAttachment,
    reset
  }
})
