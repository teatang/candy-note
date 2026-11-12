import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useLayoutStore } from '@/stores/layout'

/**
 * 工作区布局状态 Store 单元测试
 * 覆盖桌面端侧边栏折叠状态持久化、移动端抽屉与单栏切换，
 * 以及全屏编辑/查看和临时布局态重置逻辑。
 */
describe('Layout Store', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('应支持折叠与展开文件夹栏和笔记列表栏并持久化到 localStorage', () => {
    const store = useLayoutStore()

    expect(store.folderSidebarCollapsed).toBe(false)
    expect(store.noteListCollapsed).toBe(false)

    // 切换折叠文件夹栏
    store.toggleFolderSidebar()
    expect(store.folderSidebarCollapsed).toBe(true)
    expect(localStorage.getItem('candy_note_folder_sidebar_collapsed')).toBe('1')

    // 强制指定并切换笔记列表栏
    store.toggleNoteList(true)
    expect(store.noteListCollapsed).toBe(true)
    expect(localStorage.getItem('candy_note_notelist_collapsed')).toBe('1')

    // 重新初始化 Pinia 后应从 localStorage 恢复折叠偏好
    setActivePinia(createPinia())
    const restored = useLayoutStore()
    expect(restored.folderSidebarCollapsed).toBe(true)
    expect(restored.noteListCollapsed).toBe(true)

    restored.toggleFolderSidebar(false)
    restored.toggleNoteList(false)
    expect(localStorage.getItem('candy_note_folder_sidebar_collapsed')).toBe('0')
    expect(localStorage.getItem('candy_note_notelist_collapsed')).toBe('0')
  })

  it('应正确控制移动端抽屉、单栏面板切换、全屏模式与临时状态重置', () => {
    const store = useLayoutStore()

    expect(store.mobileFoldersOpen).toBe(false)
    expect(store.mobilePane).toBe('list')
    expect(store.isEditorFullscreen).toBe(false)

    store.setMobileFoldersOpen(true)
    store.setMobilePane('editor')
    store.toggleEditorFullscreen()
    store.toggleFolderSidebar(true)

    expect(store.mobileFoldersOpen).toBe(true)
    expect(store.mobilePane).toBe('editor')
    expect(store.isEditorFullscreen).toBe(true)

    // 重置临时布局态仅关闭抽屉与全屏，不应清除桌面端永久折叠偏好
    store.resetTransientLayout()
    expect(store.mobileFoldersOpen).toBe(false)
    expect(store.isEditorFullscreen).toBe(false)
    expect(store.folderSidebarCollapsed).toBe(true)
  })
})
