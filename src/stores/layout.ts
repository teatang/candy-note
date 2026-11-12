import { defineStore } from 'pinia'
import { ref } from 'vue'

const FOLDER_COLLAPSED_KEY = 'candy_note_folder_sidebar_collapsed'
const NOTELIST_COLLAPSED_KEY = 'candy_note_notelist_collapsed'

/**
 * 读取本地持久化的布尔折叠配置
 */
function readSavedFlag(key: string): boolean {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage.getItem(key) === '1'
  }
  return false
}

/**
 * 写入本地持久化的布尔折叠配置
 */
function persistFlag(key: string, value: boolean): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(key, value ? '1' : '0')
  }
}

/**
 * 工作区布局与响应式交互状态仓库
 * - 控制桌面端文件夹侧边栏与笔记列表栏的折叠/展开状态（并持久化到 localStorage）
 * - 控制移动端抽屉式文件夹开关与单栏视图切换（列表 / 编辑器）
 * - 控制笔记编辑与查看全屏模式状态
 */
export const useLayoutStore = defineStore('layout', () => {
  /** 桌面端：是否折叠左侧文件夹侧边栏 */
  const folderSidebarCollapsed = ref<boolean>(readSavedFlag(FOLDER_COLLAPSED_KEY))
  /** 桌面端：是否折叠中间笔记列表栏 */
  const noteListCollapsed = ref<boolean>(readSavedFlag(NOTELIST_COLLAPSED_KEY))
  /** 移动端：是否打开文件夹抽屉 */
  const mobileFoldersOpen = ref<boolean>(false)
  /** 移动端：当前处于笔记列表视图还是编辑/查看视图 */
  const mobilePane = ref<'list' | 'editor'>('list')
  /** 笔记编辑与预览区是否处于全屏模式 */
  const isEditorFullscreen = ref<boolean>(false)

  /** 切换桌面端文件夹侧边栏折叠状态 */
  function toggleFolderSidebar(force?: boolean) {
    folderSidebarCollapsed.value =
      force !== undefined ? force : !folderSidebarCollapsed.value
    persistFlag(FOLDER_COLLAPSED_KEY, folderSidebarCollapsed.value)
  }

  /** 切换桌面端笔记列表栏折叠状态 */
  function toggleNoteList(force?: boolean) {
    noteListCollapsed.value = force !== undefined ? force : !noteListCollapsed.value
    persistFlag(NOTELIST_COLLAPSED_KEY, noteListCollapsed.value)
  }

  /** 打开或关闭移动端文件夹抽屉 */
  function setMobileFoldersOpen(open: boolean) {
    mobileFoldersOpen.value = open
  }

  /** 切换移动端主视图面板（list / editor） */
  function setMobilePane(pane: 'list' | 'editor') {
    mobilePane.value = pane
  }

  /** 切换编辑器全屏模式（编辑与预览均可用） */
  function toggleEditorFullscreen(force?: boolean) {
    isEditorFullscreen.value = force !== undefined ? force : !isEditorFullscreen.value
  }

  /** 重置临时模态布局态（例如退出登录或切换路由时） */
  function resetTransientLayout() {
    mobileFoldersOpen.value = false
    isEditorFullscreen.value = false
  }

  return {
    folderSidebarCollapsed,
    noteListCollapsed,
    mobileFoldersOpen,
    mobilePane,
    isEditorFullscreen,
    toggleFolderSidebar,
    toggleNoteList,
    setMobileFoldersOpen,
    setMobilePane,
    toggleEditorFullscreen,
    resetTransientLayout
  }
})
