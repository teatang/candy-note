import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { filesApi } from '@/api/files'
import { foldersApi } from '@/api/folders'
import { notesApi } from '@/api/notes'
import { useNoteStore } from '@/stores/note'
import type { Folder, Note } from '@/types'

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
})
