import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiRequestError } from '@/api/client'
import { filesApi } from '@/api/files'
import { foldersApi } from '@/api/folders'
import { notesApi } from '@/api/notes'
import { useAuthStore } from '@/stores/auth'
import { getEditorStateStorageKey, NoteConflictError, useNoteStore } from '@/stores/note'
import type { Folder, Note, User } from '@/types'

/**
 * 笔记工作区 Store 单元测试
 * 覆盖文件夹层级、置顶分区、拖动排序、R2 图片上传与一周历史版本回退
 */
describe('Note Workspace Store', () => {
  const sampleFolders: Folder[] = [
    { id: 'f-1', userId: 'u-1', parentId: null, name: '工作', sortOrder: 0, createdAt: 1, updatedAt: 1 },
    { id: 'f-2', userId: 'u-1', parentId: 'f-1', name: '周报', sortOrder: 1, createdAt: 2, updatedAt: 2 },
    { id: 'f-3', userId: 'u-1', parentId: null, name: '生活', sortOrder: 2, createdAt: 3, updatedAt: 3 }
  ]

  const sampleNotes: Note[] = [
    {
      id: 'n-1',
      userId: 'u-1',
      folderId: 'f-1',
      title: '置顶计划',
      content: '# Pin',
      format: 'markdown',
      isPinned: true,
      pinnedAt: 10,
      sortOrder: 0,
      createdAt: 1,
      updatedAt: 10
    },
    {
      id: 'n-2',
      userId: 'u-1',
      folderId: 'f-1',
      title: '普通笔记 A',
      content: 'text a',
      format: 'plain',
      isPinned: false,
      pinnedAt: null,
      sortOrder: 10000,
      createdAt: 2,
      updatedAt: 20
    },
    {
      id: 'n-3',
      userId: 'u-1',
      folderId: 'f-3',
      title: '普通笔记 B',
      content: 'text b',
      format: 'markdown',
      isPinned: false,
      pinnedAt: null,
      sortOrder: 10001,
      createdAt: 3,
      updatedAt: 30
    }
  ]

  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.restoreAllMocks()
    vi.spyOn(foldersApi, 'list').mockResolvedValue({ folders: structuredClone(sampleFolders) })
    vi.spyOn(notesApi, 'list').mockResolvedValue({ notes: structuredClone(sampleNotes) })
    vi.spyOn(filesApi, 'listByNote').mockResolvedValue({ attachments: [] })
  })

  it('应正确构建文件夹嵌套深度并分别呈现置顶与普通笔记', async () => {
    const store = useNoteStore()
    await store.loadWorkspace()

    expect(store.orderedFolders.map((f) => [f.name, f.depth])).toEqual([
      ['工作', 0],
      ['周报', 1],
      ['生活', 0]
    ])
    expect(store.pinnedNotes.map((n) => n.id)).toEqual(['n-1'])
    expect(store.regularNotes.map((n) => n.id)).toEqual(['n-2', 'n-3'])
  })

  it('支持同分组笔记拖动排序并拒绝跨置顶状态直接拖动混排', async () => {
    const reorderSpy = vi.spyOn(notesApi, 'reorder').mockResolvedValue({ ok: true })
    const store = useNoteStore()
    await store.loadWorkspace()

    // 跨置顶分组拖动（n-1 已置顶，n-2 未置顶）应忽略，不调用接口
    await store.reorderNotes('n-1', 'n-2', 'before')
    expect(reorderSpy).not.toHaveBeenCalled()

    // 同为普通笔记的 n-3 拖动到 n-2 之前
    await store.reorderNotes('n-3', 'n-2', 'before')
    expect(reorderSpy).toHaveBeenCalledTimes(1)
    expect(store.regularNotes.map((n) => n.id)).toEqual(['n-3', 'n-2'])
  })

  it('支持 R2 图片上传记录与版本回退更新当前笔记内容', async () => {
    const uploadSpy = vi.spyOn(filesApi, 'upload').mockResolvedValue({
      attachment: {
        id: 'att-1',
        noteId: 'n-1',
        filename: 'shot.png',
        mimeType: 'image/png',
        size: 128,
        url: '/api/files/att-1',
        createdAt: 500
      }
    })
    const rollbackSpy = vi.spyOn(notesApi, 'rollbackVersion').mockResolvedValue({
      note: { ...sampleNotes[0], title: '回退后标题', content: '旧版本内容' },
      restoredFromVersionId: 'ver-1'
    })
    vi.spyOn(notesApi, 'listVersions').mockResolvedValue({ versions: [] })

    const store = useNoteStore()
    await store.loadWorkspace()
    await store.selectNote('n-1')

    const file = new File([new Uint8Array([1, 2])], 'shot.png', { type: 'image/png' })
    const att = await store.uploadImage(file, 'n-1')
    expect(uploadSpy).toHaveBeenCalledTimes(1)
    expect(att.url).toBe('/api/files/att-1')
    expect(store.attachments).toHaveLength(1)

    const restored = await store.rollbackVersion('n-1', 'ver-1')
    expect(rollbackSpy).toHaveBeenCalledWith('n-1', 'ver-1')
    expect(restored.title).toBe('回退后标题')
    expect(store.activeNote?.content).toBe('旧版本内容')
  })

  it('应将最后编辑的笔记 ID 与 Markdown 编辑视图模式保存到 localStorage 并在刷新后默认恢复', async () => {
    vi.spyOn(notesApi, 'update').mockImplementation(async (id, patch) => {
      const base = sampleNotes.find((n) => n.id === id)!
      return {
        note: {
          ...base,
          ...patch,
          updatedAt: Date.now()
        }
      }
    })

    const store = useNoteStore()
    await store.loadWorkspace()
    expect(store.activeNoteId).toBe('n-1')
    expect(store.markdownViewMode).toBe('split')

    // 切换到 n-3 并设置为纯编辑模式
    await store.selectNote('n-3')
    store.setMarkdownViewMode('edit')
    expect(localStorage.getItem(getEditorStateStorageKey())).toBe(
      JSON.stringify({ noteId: 'n-3', markdownViewMode: 'edit' })
    )

    // 模拟浏览器刷新/重启（重新创建 Pinia 实例）
    setActivePinia(createPinia())
    const reloaded = useNoteStore()
    await reloaded.loadWorkspace()
    expect(reloaded.activeNoteId).toBe('n-3')
    expect(reloaded.markdownViewMode).toBe('edit')

    // 切换为纯预览模式并再次模拟刷新
    reloaded.setMarkdownViewMode('preview')
    setActivePinia(createPinia())
    const reloadedPreview = useNoteStore()
    await reloadedPreview.loadWorkspace()
    expect(reloadedPreview.activeNoteId).toBe('n-3')
    expect(reloadedPreview.markdownViewMode).toBe('preview')

    // 编辑普通文本笔记 n-2（列表置顶操作非当前笔记不应覆盖最后编辑记录）
    await reloadedPreview.saveNote('n-2', { content: '更新后的文本', changeType: 'save' })
    await reloadedPreview.togglePin(sampleNotes[0])
    setActivePinia(createPinia())
    const reloadedPlain = useNoteStore()
    await reloadedPlain.loadWorkspace()
    expect(reloadedPlain.activeNoteId).toBe('n-2')
  })

  it('应按登录用户隔离持久化状态，并在笔记被删除或缓存损坏时安全回退', async () => {
    const user1: User = {
      id: 'u-1',
      username: 'alice',
      email: 'alice@example.com',
      role: 'user',
      status: 'active',
      mustChangePassword: false,
      createdAt: 1,
      updatedAt: 1,
      lastLoginAt: null
    }
    const user2: User = { ...user1, id: 'u-2', username: 'bob', email: 'bob@example.com' }

    const authStore1 = useAuthStore()
    authStore1.user = user1
    const store1 = useNoteStore()
    await store1.loadWorkspace()
    await store1.selectNote('n-3')
    store1.setMarkdownViewMode('preview')

    // 切换用户 u-2 后应互不干扰
    setActivePinia(createPinia())
    const authStore2 = useAuthStore()
    authStore2.user = user2
    const store2 = useNoteStore()
    await store2.loadWorkspace()
    expect(store2.activeNoteId).toBe('n-1')
    expect(store2.markdownViewMode).toBe('split')
    await store2.selectNote('n-2')
    store2.setMarkdownViewMode('edit')

    // 切回用户 u-1 仍可恢复其上次笔记与模式
    setActivePinia(createPinia())
    useAuthStore().user = user1
    const restored1 = useNoteStore()
    await restored1.loadWorkspace()
    expect(restored1.activeNoteId).toBe('n-3')
    expect(restored1.markdownViewMode).toBe('preview')

    // 删除当前恢复的笔记 n-3 后应更新持久化记录
    vi.spyOn(notesApi, 'remove').mockResolvedValue({ ok: true })
    await restored1.deleteNote('n-3')
    expect(restored1.activeNoteId).toBe('n-1')
    expect(JSON.parse(localStorage.getItem(getEditorStateStorageKey('u-1'))!)).toEqual({
      noteId: 'n-1',
      markdownViewMode: 'preview'
    })

    // 若本地缓存的 noteId 不存在或 JSON 损坏，加载工作区应安全回退不抛错
    localStorage.setItem(getEditorStateStorageKey('u-1'), '{bad json')
    setActivePinia(createPinia())
    useAuthStore().user = user1
    const fallbackFromBadJson = useNoteStore()
    await fallbackFromBadJson.loadWorkspace()
    expect(fallbackFromBadJson.activeNoteId).toBe('n-1')
    expect(fallbackFromBadJson.markdownViewMode).toBe('split')

    localStorage.setItem(
      getEditorStateStorageKey('u-1'),
      JSON.stringify({ noteId: 'missing-id', markdownViewMode: 'edit' })
    )
    setActivePinia(createPinia())
    useAuthStore().user = user1
    const fallbackFromMissing = useNoteStore()
    await fallbackFromMissing.loadWorkspace()
    expect(fallbackFromMissing.activeNoteId).toBe('n-1')
    expect(fallbackFromMissing.markdownViewMode).toBe('edit')
  })

  it('在纯预览模式下新建 Markdown 笔记应自动切回边写边预览以便直接编辑', async () => {
    vi.spyOn(notesApi, 'create').mockResolvedValue({
      note: {
        id: 'n-new',
        userId: 'u-1',
        folderId: null,
        title: '',
        content: '',
        format: 'markdown',
        isPinned: false,
        pinnedAt: null,
        sortOrder: 0,
        createdAt: 100,
        updatedAt: 100
      }
    })

    const store = useNoteStore()
    await store.loadWorkspace()
    store.setMarkdownViewMode('preview')

    await store.createNote('markdown')
    expect(store.activeNoteId).toBe('n-new')
    expect(store.markdownViewMode).toBe('split')
  })

  it('saveNote 在多设备并发修改导致线上版本不一致时应抛出 NoteConflictError 而不覆盖本地基线', async () => {
    const store = useNoteStore()
    await store.loadWorkspace()
    await store.selectNote('n-1')

    const serverNote: Note = {
      ...sampleNotes[0],
      content: '# 另一台设备更新后的内容',
      updatedAt: 999
    }

    vi.spyOn(notesApi, 'update').mockRejectedValueOnce(
      new ApiRequestError('NOTE_CONFLICT', '线上笔记已被其他设备更新', 409, { serverNote })
    )

    await expect(
      store.saveNote('n-1', {
        title: sampleNotes[0].title,
        content: '# 本地编辑内容',
        format: 'markdown',
        changeType: 'save'
      })
    ).rejects.toBeInstanceOf(NoteConflictError)

    expect(store.savingState).toBe('conflict')
    expect(store.activeNote?.content).toBe('# Pin')

    // 若线上仅变更了置顶/文件夹等元信息、正文与标题与本地基线完全一致，则自动同步元信息后重试保存
    const metadataOnlyServerNote: Note = {
      ...sampleNotes[0],
      isPinned: false,
      pinnedAt: null,
      updatedAt: 888
    }
    const updateSpy = vi
      .spyOn(notesApi, 'update')
      .mockRejectedValueOnce(
        new ApiRequestError('NOTE_CONFLICT', 'conflict', 409, {
          serverNote: metadataOnlyServerNote
        })
      )
      .mockResolvedValueOnce({
        note: {
          ...metadataOnlyServerNote,
          content: '# 本地新内容',
          updatedAt: 889
        }
      })

    const saved = await store.saveNote('n-1', {
      title: sampleNotes[0].title,
      content: '# 本地新内容',
      format: 'markdown',
      changeType: 'save'
    })
    expect(updateSpy).toHaveBeenCalledTimes(2)
    expect(saved.content).toBe('# 本地新内容')
    expect(store.savingState).toBe('saved')

    // applyServerNote 可直接应用线上最新版本
    store.applyServerNote(serverNote)
    expect(store.activeNote?.content).toBe('# 另一台设备更新后的内容')
    expect(store.activeNote?.updatedAt).toBe(999)
  })
})
