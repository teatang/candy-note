import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElMessageBox } from 'element-plus'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { adminApi } from '@/api/admin'
import { authApi } from '@/api/auth'
import { filesApi } from '@/api/files'
import { foldersApi } from '@/api/folders'
import { notesApi, publicShareApi } from '@/api/notes'
import { ApiRequestError } from '@/api/client'
import AppHeader from '@/components/layout/AppHeader.vue'
import FolderSidebar from '@/components/notes/FolderSidebar.vue'
import NoteEditor from '@/components/notes/NoteEditor.vue'
import NoteList from '@/components/notes/NoteList.vue'
import NoteShareDialog from '@/components/notes/NoteShareDialog.vue'
import { i18n } from '@/i18n'
import { useAuthStore } from '@/stores/auth'
import { useLayoutStore } from '@/stores/layout'
import { useNoteStore } from '@/stores/note'
import AdminView from '@/views/AdminView.vue'
import LoginView from '@/views/LoginView.vue'
import ShareView from '@/views/ShareView.vue'

/**
 * 核心 UI 组件集成测试
 * 覆盖登录页（无注册入口、图片验证码加载与点击刷新、30天自动登录勾选）、
 * 笔记编辑器（Markdown 实时边写边预览、外链新标签页打开、格式切换、全屏模式与 Esc 退出、移动端返回）、
 * 可折叠侧边栏与移动端抽屉交互，以及管理后台手动添加用户表单渲染与提交。
 */
describe('Core Vue Components', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    i18n.global.locale.value = 'zh-CN'
    vi.restoreAllMocks()
  })

  it('LoginView 应加载图片验证码、支持点击刷新且不提供前台注册入口', async () => {
    const captchaSpy = vi
      .spyOn(authApi, 'getCaptcha')
      .mockResolvedValueOnce({
        captchaId: 'c-1',
        image: 'data:image/svg+xml;base64,PHN2Zy8+',
        expiresAt: Date.now() + 60000
      })
      .mockResolvedValueOnce({
        captchaId: 'c-2',
        image: 'data:image/svg+xml;base64,PHN2ZyBpZD0iMiIvPg==',
        expiresAt: Date.now() + 60000
      })

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/login', name: 'login', component: LoginView },
        { path: '/', name: 'workspace', component: { template: '<div />' } }
      ]
    })
    await router.push('/login')
    await router.isReady()

    const wrapper = mount(LoginView, {
      global: {
        plugins: [createPinia(), router, i18n, ElementPlus]
      }
    })

    await flushPromises()
    await vi.waitFor(() => {
      expect(captchaSpy).toHaveBeenCalledTimes(1)
      expect(wrapper.find('img[alt="captcha"]').exists()).toBe(true)
    })

    const img = wrapper.find('img[alt="captcha"]')
    expect(img.attributes('src')).toBe('data:image/svg+xml;base64,PHN2Zy8+')

    // 确认页面明确展示禁止前台注册提示，无注册按钮
    expect(wrapper.text()).toContain('本站不开放前台注册')
    expect(wrapper.text()).toContain('30 天长时间自动登录')

    // 点击验证码按钮应重新请求新的验证码图片
    await wrapper.find('button[title="点击刷新验证码"]').trigger('click')
    await vi.waitFor(() => {
      expect(captchaSpy).toHaveBeenCalledTimes(2)
    })

    wrapper.unmount()
  })

  it('NoteEditor 应在 Markdown 模式下支持实时边写边预览并支持切换纯文本格式', async () => {
    vi.spyOn(foldersApi, 'list').mockResolvedValue({ folders: [] })
    vi.spyOn(notesApi, 'list').mockResolvedValue({
      notes: [
        {
          id: 'note-1',
          userId: 'u-1',
          folderId: null,
          title: 'Markdown 测试',
          content: '# 实时标题',
          format: 'markdown',
          isPinned: false,
          pinnedAt: null,
          sortOrder: 0,
          createdAt: 1,
          updatedAt: 1
        }
      ]
    })
    vi.spyOn(filesApi, 'listByNote').mockResolvedValue({ attachments: [] })
    const updateSpy = vi.spyOn(notesApi, 'update').mockImplementation(async (id, patch) => ({
      note: {
        id,
        userId: 'u-1',
        folderId: patch.folderId ?? null,
        title: patch.title ?? 'Markdown 测试',
        content: patch.content ?? '',
        format: patch.format ?? 'markdown',
        isPinned: false,
        pinnedAt: null,
        sortOrder: 0,
        createdAt: 1,
        updatedAt: 2
      }
    }))

    const pinia = createPinia()
    setActivePinia(pinia)
    const noteStore = useNoteStore()
    await noteStore.loadWorkspace()

    const wrapper = mount(NoteEditor, {
      global: {
        plugins: [pinia, i18n, ElementPlus]
      }
    })

    // 分栏模式下左侧 textarea 与右侧实时预览同时存在
    const textarea = wrapper.find('textarea')
    const preview = wrapper.find('.candy-markdown-body')
    expect(textarea.exists()).toBe(true)
    expect(preview.exists()).toBe(true)
    expect(preview.html()).toContain('<h1>实时标题</h1>')

    // 模式切换与格式切换按钮在暗黑模式下 hover 时应具备高可见度（dark:hover:text-slate-200）
    const editModeBtn = wrapper.find('[data-testid="view-mode-edit"]')
    expect(editModeBtn.exists()).toBe(true)
    expect(editModeBtn.classes()).toContain('dark:hover:text-slate-200')
    const plainFormatBtn = wrapper.find('[data-testid="format-switch-plain"]')
    expect(plainFormatBtn.exists()).toBe(true)
    expect(plainFormatBtn.classes()).toContain('dark:hover:text-slate-200')

    // 修改 Markdown 内容时右侧预览应同步更新，且外部链接自动具备新开标签页属性
    await textarea.setValue('## 更新后的副标题\n\n**加粗内容** [Cloudflare](https://cloudflare.com)')
    expect(wrapper.find('.candy-markdown-body').html()).toContain('<h2>更新后的副标题</h2>')
    expect(wrapper.find('.candy-markdown-body').html()).toContain('<strong>加粗内容</strong>')
    const previewLink = wrapper.find('.candy-markdown-body a')
    expect(previewLink.exists()).toBe(true)
    expect(previewLink.attributes('href')).toBe('https://cloudflare.com')
    expect(previewLink.attributes('target')).toBe('_blank')
    expect(previewLink.attributes('rel')).toContain('noopener')

    // 切换格式前弹出确认对话框：若用户取消，则不触发保存且维持当前格式与预览
    const confirmSpy = vi.spyOn(ElMessageBox, 'confirm')
    confirmSpy.mockRejectedValueOnce('cancel')

    const plainBtn = wrapper.find('[data-testid="format-switch-plain"]')
    expect(plainBtn.exists()).toBe(true)
    await plainBtn.trigger('click')
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(updateSpy).not.toHaveBeenCalled()
    expect(wrapper.find('.candy-markdown-body').exists()).toBe(true)

    // 用户确认切换为普通文本模式后，应关闭 Markdown 预览分栏并调用保存接口
    confirmSpy.mockResolvedValueOnce('confirm' as any)
    await plainBtn.trigger('click')
    expect(confirmSpy).toHaveBeenCalledTimes(2)
    expect(updateSpy).toHaveBeenCalledWith('note-1', expect.objectContaining({ format: 'plain' }))
    expect(wrapper.find('.candy-markdown-body').exists()).toBe(false)

    wrapper.unmount()
  })

  it('NoteEditor 支持拖入图片上传至 R2 并在 Markdown 中自动插入图片链接', async () => {
    vi.spyOn(foldersApi, 'list').mockResolvedValue({ folders: [] })
    vi.spyOn(notesApi, 'list').mockResolvedValue({
      notes: [
        {
          id: 'note-img-1',
          userId: 'u-1',
          folderId: null,
          title: '图片拖拽测试',
          content: '第一行',
          format: 'markdown',
          isPinned: false,
          pinnedAt: null,
          sortOrder: 0,
          createdAt: 1,
          updatedAt: 1
        }
      ]
    })
    vi.spyOn(filesApi, 'listByNote').mockResolvedValue({ attachments: [] })
    const uploadSpy = vi.spyOn(filesApi, 'upload').mockResolvedValue({
      attachment: {
        id: 'r2-img-99',
        noteId: 'note-img-1',
        filename: 'demo.png',
        mimeType: 'image/png',
        size: 64,
        url: '/api/files/r2-img-99',
        createdAt: 100
      }
    })

    const pinia = createPinia()
    setActivePinia(pinia)
    const noteStore = useNoteStore()
    await noteStore.loadWorkspace()

    const wrapper = mount(NoteEditor, {
      global: {
        plugins: [pinia, i18n, ElementPlus]
      }
    })

    const file = new File([new Uint8Array([1, 2, 3])], 'demo.png', { type: 'image/png' })
    const dropZone = wrapper.find('div.relative.flex.min-h-0.flex-1')
    await dropZone.trigger('drop', {
      dataTransfer: {
        files: [file],
        types: ['Files']
      }
    })

    await flushPromises()
    expect(uploadSpy).toHaveBeenCalledTimes(1)
    expect(wrapper.find('textarea').element.value).toContain('![demo.png](/api/files/r2-img-99)')

    wrapper.unmount()
  })

  it('NoteEditor 应支持全屏编辑/查看切换、Esc 退出全屏及移动端返回列表', async () => {
    vi.spyOn(foldersApi, 'list').mockResolvedValue({ folders: [] })
    vi.spyOn(notesApi, 'list').mockResolvedValue({
      notes: [
        {
          id: 'note-fs-1',
          userId: 'u-1',
          folderId: null,
          title: '全屏测试笔记',
          content: '测试内容',
          format: 'markdown',
          isPinned: false,
          pinnedAt: null,
          sortOrder: 0,
          createdAt: 1,
          updatedAt: 1
        }
      ]
    })
    vi.spyOn(filesApi, 'listByNote').mockResolvedValue({ attachments: [] })

    const pinia = createPinia()
    setActivePinia(pinia)
    const noteStore = useNoteStore()
    const layoutStore = useLayoutStore()
    await noteStore.loadWorkspace()
    layoutStore.setMobilePane('editor')

    const wrapper = mount(NoteEditor, {
      global: {
        plugins: [pinia, i18n, ElementPlus]
      }
    })

    const editorMain = wrapper.find('[data-testid="note-editor"]')
    expect(layoutStore.isEditorFullscreen).toBe(false)
    expect(editorMain.classes()).not.toContain('fixed')

    // 保存按钮旁边的全屏按钮已移除
    expect(wrapper.find('[data-testid="toggle-fullscreen"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="save-note-btn"]').exists()).toBe(true)

    // 触发全屏模式下状态响应
    layoutStore.toggleEditorFullscreen(true)
    await flushPromises()
    expect(layoutStore.isEditorFullscreen).toBe(true)
    expect(editorMain.classes()).toContain('fixed')
    expect(editorMain.classes()).toContain('z-50')

    // 触发 Esc 键退出全屏模式
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(layoutStore.isEditorFullscreen).toBe(false)
    expect(editorMain.classes()).not.toContain('fixed')

    // 再次全屏后点击移动端返回列表按钮，应同时退出全屏并切回 list 视图
    layoutStore.toggleEditorFullscreen(true)
    await flushPromises()
    expect(layoutStore.isEditorFullscreen).toBe(true)
    await wrapper.find('[data-testid="mobile-back-to-list"]').trigger('click')
    expect(layoutStore.isEditorFullscreen).toBe(false)
    expect(layoutStore.mobilePane).toBe('list')

    wrapper.unmount()
  })

  it('NoteEditor 与 NoteList 应记录最后编辑的笔记与 Markdown 编辑状态并在刷新重挂载后恢复', async () => {
    const notesData = [
      {
        id: 'note-1',
        userId: 'u-1',
        folderId: null,
        title: '第一篇笔记',
        content: '# 第一篇',
        format: 'markdown' as const,
        isPinned: false,
        pinnedAt: null,
        sortOrder: 0,
        createdAt: 1,
        updatedAt: 1
      },
      {
        id: 'note-2',
        userId: 'u-1',
        folderId: null,
        title: '纯文本笔记',
        content: 'plain body',
        format: 'plain' as const,
        isPinned: false,
        pinnedAt: null,
        sortOrder: 1,
        createdAt: 2,
        updatedAt: 2
      },
      {
        id: 'note-3',
        userId: 'u-1',
        folderId: null,
        title: '目标 Markdown 笔记',
        content: '# 目标标题\n\n目标正文',
        format: 'markdown' as const,
        isPinned: false,
        pinnedAt: null,
        sortOrder: 2,
        createdAt: 3,
        updatedAt: 3
      }
    ]
    vi.spyOn(foldersApi, 'list').mockResolvedValue({ folders: [] })
    vi.spyOn(notesApi, 'list').mockImplementation(async () => ({ notes: structuredClone(notesData) }))
    vi.spyOn(filesApi, 'listByNote').mockResolvedValue({ attachments: [] })

    // 首次进入：默认打开第一篇笔记且为边写边预览 (split)
    let pinia = createPinia()
    setActivePinia(pinia)
    let noteStore = useNoteStore()
    await noteStore.loadWorkspace()

    let listWrapper = mount(NoteList, {
      global: { plugins: [pinia, i18n, ElementPlus] }
    })
    let editorWrapper = mount(NoteEditor, {
      global: { plugins: [pinia, i18n, ElementPlus] }
    })

    expect(noteStore.activeNoteId).toBe('note-1')
    expect(editorWrapper.find('textarea').exists()).toBe(true)
    expect(editorWrapper.find('.candy-markdown-body').exists()).toBe(true)

    // 点击切换到第三篇 Markdown 笔记并编辑内容，然后切换为“纯编辑”模式
    const targetCard = listWrapper
      .findAll('div.cursor-pointer')
      .find((el) => el.text().includes('目标 Markdown 笔记'))
    expect(targetCard).toBeDefined()
    await targetCard!.trigger('click')
    await flushPromises()
    expect(noteStore.activeNoteId).toBe('note-3')

    await editorWrapper.find('textarea').setValue('# 已编辑标题\n\n新内容')
    await editorWrapper.find('[data-testid="view-mode-edit"]').trigger('click')
    expect(editorWrapper.find('textarea').exists()).toBe(true)
    expect(editorWrapper.find('.candy-markdown-body').exists()).toBe(false)

    listWrapper.unmount()
    editorWrapper.unmount()

    // 模拟浏览器刷新/重启：创建新的 Pinia 与组件实例，应默认打开 note-3 且处于纯编辑模式
    pinia = createPinia()
    setActivePinia(pinia)
    noteStore = useNoteStore()
    await noteStore.loadWorkspace()
    editorWrapper = mount(NoteEditor, {
      global: { plugins: [pinia, i18n, ElementPlus] }
    })

    expect(noteStore.activeNoteId).toBe('note-3')
    expect(
      (editorWrapper.find('input[placeholder="输入笔记标题..."]').element as HTMLInputElement).value
    ).toBe('目标 Markdown 笔记')
    expect(editorWrapper.find('textarea').exists()).toBe(true)
    expect(editorWrapper.find('.candy-markdown-body').exists()).toBe(false)

    // 切换为“纯预览”模式并再次模拟刷新，应保持纯预览模式
    await editorWrapper.find('[data-testid="view-mode-preview"]').trigger('click')
    expect(editorWrapper.find('textarea').exists()).toBe(false)
    expect(editorWrapper.find('.candy-markdown-body').exists()).toBe(true)
    editorWrapper.unmount()

    pinia = createPinia()
    setActivePinia(pinia)
    noteStore = useNoteStore()
    await noteStore.loadWorkspace()
    editorWrapper = mount(NoteEditor, {
      global: { plugins: [pinia, i18n, ElementPlus] }
    })

    expect(noteStore.activeNoteId).toBe('note-3')
    expect(editorWrapper.find('textarea').exists()).toBe(false)
    expect(editorWrapper.find('.candy-markdown-body').html()).toContain('<h1>目标标题</h1>')

    editorWrapper.unmount()
  })

  it('NoteEditor 保存前检测到线上版本与本地基线不一致时应弹窗展示双版本对比并等待用户确认后再保存', async () => {
    const initialNote = {
      id: 'note-conflict-1',
      userId: 'u-1',
      folderId: null,
      title: '协同笔记',
      content: '初始正文',
      format: 'markdown' as const,
      isPinned: false,
      pinnedAt: null,
      sortOrder: 0,
      createdAt: 100,
      updatedAt: 100
    }
    const serverUpdatedNote = {
      ...initialNote,
      title: '协同笔记（手机端修改）',
      content: '手机端最新正文内容',
      updatedAt: 200
    }

    vi.spyOn(foldersApi, 'list').mockResolvedValue({ folders: [] })
    vi.spyOn(notesApi, 'list').mockResolvedValue({ notes: [initialNote] })
    vi.spyOn(filesApi, 'listByNote').mockResolvedValue({ attachments: [] })

    const updateSpy = vi
      .spyOn(notesApi, 'update')
      .mockRejectedValueOnce(
        new ApiRequestError('NOTE_CONFLICT', '线上笔记已被其他设备更新', 409, {
          serverNote: serverUpdatedNote
        })
      )
      .mockResolvedValueOnce({
        note: {
          ...initialNote,
          title: '协同笔记（已合并标题）',
          content: '电脑端与手机端合并后的正文',
          format: 'plain',
          updatedAt: 300
        }
      })

    const pinia = createPinia()
    setActivePinia(pinia)
    const noteStore = useNoteStore()
    await noteStore.loadWorkspace()

    const wrapper = mount(NoteEditor, {
      attachTo: document.body,
      global: { plugins: [pinia, i18n, ElementPlus] }
    })

    // 本地编辑后点击保存，首次请求触发 409 冲突
    await wrapper.find('textarea').setValue('电脑端待保存内容')
    await wrapper.find('[data-testid="save-note-btn"]').trigger('click')
    await flushPromises()

    expect(updateSpy).toHaveBeenCalledTimes(1)
    expect(noteStore.savingState).toBe('conflict')

    // 应弹出冲突对比对话框，同时展示线上最新版本与可编辑的本地待保存版本
    const dialog = document.body.querySelector('[data-testid="note-conflict-dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog!.textContent).toContain('线上最新版本')
    expect(dialog!.textContent).toContain('手机端最新正文内容')
    expect(dialog!.textContent).toContain('本地待保存版本')

    const localTitleInput = document.body.querySelector(
      '[data-testid="conflict-local-title-input"]'
    ) as HTMLInputElement
    const localContentInput = document.body.querySelector(
      '[data-testid="conflict-local-content-input"]'
    ) as HTMLTextAreaElement
    expect(localTitleInput).not.toBeNull()
    expect(localContentInput).not.toBeNull()
    expect(localContentInput.value).toBe('电脑端待保存内容')

    // 冲突弹窗应支持切换全屏编辑，并支持按 Esc 退出全屏且保持冲突弹窗打开
    const elDialog = document.body.querySelector('.el-dialog') as HTMLElement
    const fullscreenBtn = document.body.querySelector(
      '[data-testid="conflict-toggle-fullscreen"]'
    ) as HTMLElement
    expect(fullscreenBtn).not.toBeNull()
    expect(elDialog.classList.contains('is-fullscreen')).toBe(false)

    fullscreenBtn.click()
    await flushPromises()
    expect(elDialog.classList.contains('is-fullscreen')).toBe(true)
    expect(elDialog.classList.contains('candy-conflict-dialog-fullscreen')).toBe(true)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(elDialog.classList.contains('is-fullscreen')).toBe(false)
    expect(document.body.querySelector('[data-testid="note-conflict-dialog"]')).not.toBeNull()

    // 在冲突页面直接修改本地待保存版本的标题、正文与格式
    localTitleInput.value = '协同笔记（已合并标题）'
    localTitleInput.dispatchEvent(new Event('input', { bubbles: true }))
    localContentInput.value = '电脑端与手机端合并后的正文'
    localContentInput.dispatchEvent(new Event('input', { bubbles: true }))
    const plainFormatBtn = document.body.querySelector(
      '[data-testid="conflict-local-format-plain"]'
    ) as HTMLElement
    plainFormatBtn.click()
    await flushPromises()

    // 点击“取消（继续编辑）”应关闭弹窗并把冲突页面中的编辑同步保留到主编辑器，且不执行覆盖保存
    const cancelBtn = document.body.querySelector('[data-testid="conflict-cancel"]') as HTMLElement
    cancelBtn.click()
    await flushPromises()
    expect(updateSpy).toHaveBeenCalledTimes(1)
    expect(
      (wrapper.find('input[placeholder="输入笔记标题..."]').element as HTMLInputElement).value
    ).toBe('协同笔记（已合并标题）')
    expect(wrapper.find('textarea').element.value).toBe('电脑端与手机端合并后的正文')
    expect(wrapper.find('[data-testid="note-conflict-banner"]').exists()).toBe(true)

    // 点击顶部提醒条重新打开弹窗并点击“确认覆盖保存”，此时应携带编辑后的本地版本与线上最新时间戳提交保存
    await wrapper.find('[data-testid="reopen-conflict-btn"]').trigger('click')
    await flushPromises()
    const confirmBtn = document.body.querySelector(
      '[data-testid="conflict-confirm-save"]'
    ) as HTMLElement
    confirmBtn.click()
    await flushPromises()

    expect(updateSpy).toHaveBeenCalledTimes(2)
    expect(updateSpy.mock.calls[1][1]).toMatchObject({
      title: '协同笔记（已合并标题）',
      content: '电脑端与手机端合并后的正文',
      format: 'plain',
      expectedUpdatedAt: 200,
      confirmConflict: true
    })
    expect(noteStore.savingState).toBe('saved')
    expect(wrapper.find('[data-testid="note-conflict-banner"]').exists()).toBe(false)

    // 再次模拟冲突并测试“采用线上版本”分支
    updateSpy.mockRejectedValueOnce(
      new ApiRequestError('NOTE_CONFLICT', '线上笔记已被其他设备更新', 409, {
        serverNote: { ...serverUpdatedNote, updatedAt: 400, content: '线上二次更新内容' }
      })
    )
    await wrapper.find('textarea').setValue('本地另一段编辑')
    await wrapper.find('[data-testid="save-note-btn"]').trigger('click')
    await flushPromises()

    const useServerBtn = document.body.querySelector(
      '[data-testid="conflict-use-server"]'
    ) as HTMLElement
    useServerBtn.click()
    await flushPromises()
    expect(wrapper.find('textarea').element.value).toBe('线上二次更新内容')
    expect(noteStore.activeNote?.updatedAt).toBe(400)

    wrapper.unmount()
  })

  it('AppHeader、FolderSidebar 与 NoteList 应联动支持折叠侧边栏与移动端文件夹抽屉', async () => {
    vi.spyOn(foldersApi, 'list').mockResolvedValue({ folders: [] })
    vi.spyOn(notesApi, 'list').mockResolvedValue({ notes: [] })

    const pinia = createPinia()
    setActivePinia(pinia)
    const noteStore = useNoteStore()
    const layoutStore = useLayoutStore()
    await noteStore.loadWorkspace()

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'workspace', component: { template: '<div />' } },
        { path: '/login', name: 'login', component: { template: '<div />' } },
        { path: '/admin', name: 'admin', component: { template: '<div />' } }
      ]
    })
    await router.push('/')
    await router.isReady()

    const headerWrapper = mount(AppHeader, {
      global: { plugins: [pinia, router, i18n, ElementPlus] }
    })
    const folderWrapper = mount(FolderSidebar, {
      global: { plugins: [pinia, i18n, ElementPlus] }
    })
    const noteListWrapper = mount(NoteList, {
      global: { plugins: [pinia, i18n, ElementPlus] }
    })

    // 桌面端折叠文件夹侧边栏
    expect(folderWrapper.find('[data-testid="folder-sidebar"]').classes()).toContain('md:w-60')
    await headerWrapper.find('[data-testid="toggle-folder-sidebar"]').trigger('click')
    expect(layoutStore.folderSidebarCollapsed).toBe(true)
    expect(folderWrapper.find('[data-testid="folder-sidebar"]').classes()).toContain('md:w-0')

    // 桌面端折叠笔记列表栏
    expect(noteListWrapper.find('[data-testid="note-list-sidebar"]').classes()).toContain('md:w-76')
    await headerWrapper.find('[data-testid="toggle-note-list"]').trigger('click')
    expect(layoutStore.noteListCollapsed).toBe(true)
    expect(noteListWrapper.find('[data-testid="note-list-sidebar"]').classes()).toContain('md:w-0')

    // 移动端点击菜单按钮打开文件夹抽屉
    expect(layoutStore.mobileFoldersOpen).toBe(false)
    await headerWrapper.find('[data-testid="mobile-folders-btn"]').trigger('click')
    expect(layoutStore.mobileFoldersOpen).toBe(true)
    expect(folderWrapper.find('[data-testid="folder-sidebar"]').classes()).toContain('translate-x-0')

    headerWrapper.unmount()
    folderWrapper.unmount()
    noteListWrapper.unmount()
  })

  it('AdminView 点击手动添加用户时应明确展示用户昵称、电子邮箱与密码输入区域并支持提交创建', async () => {
    vi.spyOn(adminApi, 'getStats').mockResolvedValue({
      stats: {
        users: { total: 1, active: 1, disabled: 0, admins: 1 },
        notes: { total: 0, markdown: 0, plain: 0, pinned: 0 },
        folders: { total: 0 },
        versions: { totalLast7Days: 0 },
        attachments: { totalCount: 0, totalSizeBytes: 0 },
        recentLogins: [],
        userSummaries: []
      }
    })
    vi.spyOn(adminApi, 'listUsers').mockResolvedValue({
      users: [
        {
          id: 'u-admin',
          username: 'admin',
          email: 'admin@candynote.local',
          role: 'admin',
          status: 'active',
          mustChangePassword: false,
          createdAt: 1,
          updatedAt: 1,
          lastLoginAt: null
        }
      ]
    })
    const createUserSpy = vi.spyOn(adminApi, 'createUser').mockResolvedValue({
      user: {
        id: 'u-new',
        username: 'CandyTester',
        email: 'tester@candynote.dev',
        role: 'user',
        status: 'active',
        mustChangePassword: false,
        createdAt: 2,
        updatedAt: 2,
        lastLoginAt: null
      }
    })

    const pinia = createPinia()
    setActivePinia(pinia)
    const authStore = useAuthStore()
    authStore.user = {
      id: 'u-admin',
      username: 'admin',
      email: 'admin@candynote.local',
      role: 'admin',
      status: 'active',
      mustChangePassword: false,
      createdAt: 1,
      updatedAt: 1,
      lastLoginAt: null
    }

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'workspace', component: { template: '<div />' } },
        { path: '/login', name: 'login', component: { template: '<div />' } },
        { path: '/admin', name: 'admin', component: AdminView }
      ]
    })
    await router.push('/admin')
    await router.isReady()

    const wrapper = mount(AdminView, {
      attachTo: document.body,
      global: { plugins: [pinia, router, i18n, ElementPlus] }
    })

    await flushPromises()

    // 点击“手动添加用户”按钮打开新建用户弹窗
    const addBtn = wrapper.findAll('button').find((b) => b.text().includes('手动添加用户'))
    expect(addBtn).toBeDefined()
    await addBtn!.trigger('click')
    await flushPromises()

    const dialog = document.body.querySelector('.el-dialog')
    expect(dialog).not.toBeNull()
    expect(dialog!.textContent).toContain('用户昵称（用户名）')
    expect(dialog!.textContent).toContain('电子邮箱')
    expect(dialog!.textContent).toContain('登录密码')

    const usernameInput = dialog!.querySelector(
      'input[placeholder*="2-32位字符"]'
    ) as HTMLInputElement | null
    const emailInput = dialog!.querySelector(
      'input[placeholder="name@example.com"]'
    ) as HTMLInputElement | null
    const passwordInput = dialog!.querySelector('input[type="password"]') as HTMLInputElement | null

    expect(usernameInput).not.toBeNull()
    expect(emailInput).not.toBeNull()
    expect(passwordInput).not.toBeNull()

    usernameInput!.value = 'CandyTester'
    usernameInput!.dispatchEvent(new Event('input'))
    emailInput!.value = 'tester@candynote.dev'
    emailInput!.dispatchEvent(new Event('input'))
    passwordInput!.value = 'Secret123!'
    passwordInput!.dispatchEvent(new Event('input'))
    await flushPromises()

    const form = dialog!.querySelector('form')!
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()

    expect(createUserSpy).toHaveBeenCalledWith({
      username: 'CandyTester',
      email: 'tester@candynote.dev',
      password: 'Secret123!',
      role: 'user',
      status: 'active'
    })

    // 切换英文文案后再次打开添加用户弹窗，同样应完整展示昵称与邮箱输入项
    i18n.global.locale.value = 'en-US'
    await flushPromises()
    const addBtnEn = wrapper.findAll('button').find((b) => b.text().includes('Add User'))
    expect(addBtnEn).toBeDefined()
    await addBtnEn!.trigger('click')
    await flushPromises()

    const dialogEn = document.body.querySelector('.el-dialog')
    expect(dialogEn).not.toBeNull()
    expect(dialogEn!.textContent).toContain('Nickname (Username)')
    expect(dialogEn!.textContent).toContain('Email')
    expect(
      dialogEn!.querySelector('input[placeholder*="no @ or whitespace"]')
    ).not.toBeNull()

    wrapper.unmount()
  })

  it('NoteEditor 在普通文本与 Markdown 双格式实时切换前必须弹出确认提示，用户取消则保持原格式，确认后方才切换并保存', async () => {
    vi.spyOn(foldersApi, 'list').mockResolvedValue({ folders: [] })
    vi.spyOn(notesApi, 'list').mockResolvedValue({
      notes: [
        {
          id: 'note-format-1',
          userId: 'u-1',
          folderId: null,
          title: '格式切换测试笔记',
          content: '# 标题内容\n正文',
          format: 'markdown',
          isPinned: false,
          pinnedAt: null,
          sortOrder: 0,
          createdAt: 100,
          updatedAt: 100
        }
      ]
    })
    vi.spyOn(filesApi, 'listByNote').mockResolvedValue({ attachments: [] })
    const updateSpy = vi.spyOn(notesApi, 'update').mockImplementation(async (id, patch) => ({
      note: {
        id,
        userId: 'u-1',
        folderId: patch.folderId ?? null,
        title: patch.title ?? '格式切换测试笔记',
        content: patch.content ?? '# 标题内容\n正文',
        format: patch.format ?? 'markdown',
        isPinned: false,
        pinnedAt: null,
        sortOrder: 0,
        createdAt: 100,
        updatedAt: 101
      }
    }))

    const pinia = createPinia()
    setActivePinia(pinia)
    const noteStore = useNoteStore()
    await noteStore.loadWorkspace()

    const wrapper = mount(NoteEditor, {
      global: {
        plugins: [pinia, i18n, ElementPlus]
      }
    })

    const confirmSpy = vi.spyOn(ElMessageBox, 'confirm')

    const mdBtn = wrapper.find('[data-testid="format-switch-markdown"]')
    const plainBtn = wrapper.find('[data-testid="format-switch-plain"]')
    expect(mdBtn.exists()).toBe(true)
    expect(plainBtn.exists()).toBe(true)

    // 1. 点击当前已选中的 Markdown 格式：无需弹窗确认，亦不重复触发保存
    await mdBtn.trigger('click')
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(updateSpy).not.toHaveBeenCalled()

    // 2. 尝试从 Markdown 切换为普通文本 (plain)，但在确认弹窗中取消
    confirmSpy.mockRejectedValueOnce('cancel')
    await plainBtn.trigger('click')
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(confirmSpy).toHaveBeenLastCalledWith(
      '确定将当前笔记切换为普通文本格式吗？切换后将关闭 Markdown 语法渲染、分栏实时预览与快捷格式工具栏。',
      '切换笔记格式',
      expect.objectContaining({
        type: 'warning',
        confirmButtonText: '确定',
        cancelButtonText: '取消'
      })
    )
    expect(updateSpy).not.toHaveBeenCalled()
    expect(wrapper.find('.candy-markdown-body').exists()).toBe(true)

    // 3. 再次点击普通文本并确认切换：触发保存，格式变为 plain，预览分栏关闭
    confirmSpy.mockResolvedValueOnce('confirm' as any)
    await plainBtn.trigger('click')
    expect(confirmSpy).toHaveBeenCalledTimes(2)
    expect(updateSpy).toHaveBeenCalledWith('note-format-1', expect.objectContaining({
      format: 'plain',
      changeType: 'save'
    }))
    expect(wrapper.find('.candy-markdown-body').exists()).toBe(false)

    // 4. 当前已是普通文本，再次点击普通文本：不弹窗也不重复保存
    await plainBtn.trigger('click')
    expect(confirmSpy).toHaveBeenCalledTimes(2)
    expect(updateSpy).toHaveBeenCalledTimes(1)

    // 5. 尝试从普通文本切换回 Markdown，但在确认弹窗中点击右上角关闭
    confirmSpy.mockRejectedValueOnce('close')
    await mdBtn.trigger('click')
    expect(confirmSpy).toHaveBeenCalledTimes(3)
    expect(confirmSpy).toHaveBeenLastCalledWith(
      '确定将当前笔记切换为 Markdown 格式吗？切换后将开启 Markdown 语法渲染、分栏实时预览与快捷格式工具栏。',
      '切换笔记格式',
      expect.objectContaining({
        type: 'warning',
        confirmButtonText: '确定',
        cancelButtonText: '取消'
      })
    )
    expect(updateSpy).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.candy-markdown-body').exists()).toBe(false)

    // 6. 再次点击 Markdown 并确认切换：触发保存，格式变为 markdown，恢复实时预览
    confirmSpy.mockResolvedValueOnce('confirm' as any)
    await mdBtn.trigger('click')
    expect(confirmSpy).toHaveBeenCalledTimes(4)
    expect(updateSpy).toHaveBeenCalledTimes(2)
    expect(updateSpy).toHaveBeenLastCalledWith('note-format-1', expect.objectContaining({
      format: 'markdown',
      changeType: 'save'
    }))
    expect(wrapper.find('.candy-markdown-body').exists()).toBe(true)

    wrapper.unmount()
  })

  it('NoteEditor 在慢响应自动保存期间用户继续编辑正文时，保存返回绝不覆盖正在编辑的最新内容，并自动跟进保存增量变更', async () => {
    vi.useFakeTimers()
    const initialNote = {
      id: 'note-slow-save-1',
      userId: 'u-1',
      folderId: null,
      title: '慢响应笔记',
      content: '初始正文',
      format: 'markdown' as const,
      isPinned: false,
      pinnedAt: null,
      sortOrder: 0,
      createdAt: 100,
      updatedAt: 100
    }

    vi.spyOn(foldersApi, 'list').mockResolvedValue({ folders: [] })
    vi.spyOn(notesApi, 'list').mockResolvedValue({ notes: [initialNote] })
    vi.spyOn(filesApi, 'listByNote').mockResolvedValue({ attachments: [] })

    let resolveFirstUpdate: (val?: unknown) => void
    const firstUpdatePromise = new Promise((resolve) => {
      resolveFirstUpdate = resolve
    })

    const updateSpy = vi
      .spyOn(notesApi, 'update')
      .mockImplementationOnce(async (id, patch) => {
        await firstUpdatePromise
        return {
          note: {
            ...initialNote,
            title: patch.title ?? initialNote.title,
            content: patch.content ?? initialNote.content,
            format: patch.format ?? initialNote.format,
            updatedAt: 200
          }
        }
      })
      .mockImplementationOnce(async (id, patch) => {
        return {
          note: {
            ...initialNote,
            title: patch.title ?? initialNote.title,
            content: patch.content ?? initialNote.content,
            format: patch.format ?? initialNote.format,
            updatedAt: 300
          }
        }
      })

    const pinia = createPinia()
    setActivePinia(pinia)
    const noteStore = useNoteStore()
    await noteStore.loadWorkspace()

    const wrapper = mount(NoteEditor, {
      attachTo: document.body,
      global: { plugins: [pinia, i18n, ElementPlus] }
    })
    await flushPromises()
    await vi.advanceTimersByTimeAsync(10)

    const textarea = wrapper.find('textarea')
    expect(textarea.element.value).toBe('初始正文')

    // 1. 用户第一次修改内容
    await textarea.setValue('第一次修改的内容')
    // 推进 1.5 秒触发自动保存
    await vi.advanceTimersByTimeAsync(1500)

    // 第一次保存请求已发出，正在慢响应中
    expect(updateSpy).toHaveBeenCalledTimes(1)
    expect(updateSpy.mock.calls[0][1]).toMatchObject({
      content: '第一次修改的内容',
      expectedUpdatedAt: 100
    })

    // 2. 在服务器慢响应尚未返回的等待期间，用户继续在编辑器中打字输入
    await textarea.setValue('第一次修改的内容 + 正在继续打字的最新内容')
    expect(textarea.element.value).toBe('第一次修改的内容 + 正在继续打字的最新内容')

    // 3. 此时服务端第一次慢保存响应终于返回成功！
    resolveFirstUpdate!()
    await flushPromises()

    // 核心断言：用户的编辑内容绝不能被第一次保存返回的旧内容 ('第一次修改的内容') 覆盖掉！
    expect(textarea.element.value).toBe('第一次修改的内容 + 正在继续打字的最新内容')

    // 4. 推进时间，系统自动将慢响应期间用户输入的增量内容跟进保存
    await vi.advanceTimersByTimeAsync(1500)
    await flushPromises()

    // 第二次保存触发，且使用最新的 expectedUpdatedAt (200) 与最新的草稿内容
    expect(updateSpy).toHaveBeenCalledTimes(2)
    expect(updateSpy.mock.calls[1][1]).toMatchObject({
      content: '第一次修改的内容 + 正在继续打字的最新内容',
      expectedUpdatedAt: 200
    })
    expect(textarea.element.value).toBe('第一次修改的内容 + 正在继续打字的最新内容')

    wrapper.unmount()
    vi.useRealTimers()
  })

  it('NoteEditor 在慢响应保存进行中用户继续编辑并点击手动保存时，应排队等待并在首个请求返回后以最新基准版本保存最新修改', async () => {
    vi.useFakeTimers()
    const initialNote = {
      id: 'note-slow-save-manual-1',
      userId: 'u-1',
      folderId: null,
      title: '手动保存排队笔记',
      content: '初始正文',
      format: 'markdown' as const,
      isPinned: false,
      pinnedAt: null,
      sortOrder: 0,
      createdAt: 100,
      updatedAt: 100
    }

    vi.spyOn(foldersApi, 'list').mockResolvedValue({ folders: [] })
    vi.spyOn(notesApi, 'list').mockResolvedValue({ notes: [initialNote] })
    vi.spyOn(filesApi, 'listByNote').mockResolvedValue({ attachments: [] })

    let resolveFirstUpdate: (val?: unknown) => void
    const firstUpdatePromise = new Promise((resolve) => {
      resolveFirstUpdate = resolve
    })

    const updateSpy = vi
      .spyOn(notesApi, 'update')
      .mockImplementationOnce(async (id, patch) => {
        await firstUpdatePromise
        return {
          note: {
            ...initialNote,
            title: patch.title ?? initialNote.title,
            content: patch.content ?? initialNote.content,
            format: patch.format ?? initialNote.format,
            updatedAt: 200
          }
        }
      })
      .mockImplementationOnce(async (id, patch) => {
        return {
          note: {
            ...initialNote,
            title: patch.title ?? initialNote.title,
            content: patch.content ?? initialNote.content,
            format: patch.format ?? initialNote.format,
            updatedAt: 300
          }
        }
      })

    const pinia = createPinia()
    setActivePinia(pinia)
    const noteStore = useNoteStore()
    await noteStore.loadWorkspace()

    const wrapper = mount(NoteEditor, {
      attachTo: document.body,
      global: { plugins: [pinia, i18n, ElementPlus] }
    })
    await flushPromises()
    await vi.advanceTimersByTimeAsync(10)

    const textarea = wrapper.find('textarea')

    // 1. 用户触发自动保存
    await textarea.setValue('自动保存内容')
    await vi.advanceTimersByTimeAsync(1500)
    expect(updateSpy).toHaveBeenCalledTimes(1)

    // 2. 在慢响应期间继续输入并点击保存按钮
    await textarea.setValue('自动保存内容 + 手动输入加急内容')
    const manualSavePromise = wrapper.find('[data-testid="save-note-btn"]').trigger('click')

    // 3. 此时首个请求仍然 pending，次个请求尚未发出（避免 409 冲突）
    expect(updateSpy).toHaveBeenCalledTimes(1)

    // 4. 首个慢请求返回
    resolveFirstUpdate!()
    await flushPromises()
    await manualSavePromise
    await flushPromises()

    // 5. 第二个请求已发出，且携带了首个请求返回的 updatedAt: 200
    expect(updateSpy).toHaveBeenCalledTimes(2)
    expect(updateSpy.mock.calls[1][1]).toMatchObject({
      content: '自动保存内容 + 手动输入加急内容',
      expectedUpdatedAt: 200
    })
    expect(textarea.element.value).toBe('自动保存内容 + 手动输入加急内容')

    wrapper.unmount()
    vi.useRealTimers()
  })

  it('NoteEditor 在普通文本笔记模式下应渲染 Tiptap 富文本编辑器与工具栏，并支持富文本排版与图片插入', async () => {
    const plainNote = {
      id: 'note-plain-tiptap-1',
      userId: 'u-1',
      folderId: null,
      title: '富文本笔记测试',
      content: '<p>欢迎使用 <strong>Tiptap</strong> 富文本编辑器</p>',
      format: 'plain' as const,
      isPinned: false,
      pinnedAt: null,
      sortOrder: 0,
      createdAt: 100,
      updatedAt: 100
    }

    vi.spyOn(foldersApi, 'list').mockResolvedValue({ folders: [] })
    vi.spyOn(notesApi, 'list').mockResolvedValue({ notes: [plainNote] })
    vi.spyOn(filesApi, 'listByNote').mockResolvedValue({ attachments: [] })
    vi.spyOn(notesApi, 'update').mockResolvedValue({
      note: { ...plainNote, updatedAt: 200 }
    })

    const pinia = createPinia()
    setActivePinia(pinia)
    const noteStore = useNoteStore()
    await noteStore.loadWorkspace()

    const wrapper = mount(NoteEditor, {
      attachTo: document.body,
      global: { plugins: [pinia, i18n, ElementPlus] }
    })
    await flushPromises()

    // 1. 验证渲染了 Tiptap 富文本编辑器与其专属工具栏，且原 Markdown 专属工具栏那一行（含单独插入图片按钮）不渲染
    expect(wrapper.find('[data-testid="markdown-toolbar"]').exists()).toBe(false)
    const tiptapWrapper = wrapper.find('.candy-tiptap-wrapper')
    expect(tiptapWrapper.exists()).toBe(true)

    const tiptapToolbar = wrapper.find('.candy-tiptap-toolbar')
    expect(tiptapToolbar.exists()).toBe(true)
    expect(tiptapToolbar.find('button[title="一级标题"]').exists()).toBe(true)
    expect(tiptapToolbar.find('button[title^="加粗"]').exists()).toBe(true)
    expect(tiptapToolbar.find('button[title^="斜体"]').exists()).toBe(true)
    expect(tiptapToolbar.find('button[title="无序列表"]').exists()).toBe(true)
    expect(tiptapToolbar.find('button[title="代码块"]').exists()).toBe(true)

    // 2. 验证 Tiptap 编辑器内容初始化渲染正常
    const tiptapContent = wrapper.find('.candy-tiptap-content')
    expect(tiptapContent.exists()).toBe(true)
    expect(tiptapContent.html()).toContain('<strong>Tiptap</strong>')

    // 3. 测试通过富文本组件实例插入图片
    const tiptapComponent = wrapper.findComponent({ name: 'TiptapEditor' })
    expect(tiptapComponent.exists()).toBe(true)
    tiptapComponent.vm.insertImage('/api/files/test-img.png', '测试图片')
    await flushPromises()

    expect(tiptapContent.html()).toContain('<img')
    expect(tiptapContent.html()).toContain('src="/api/files/test-img.png"')

    wrapper.unmount()
  })

  it('TiptapEditor 富文本编辑器应支持点击工具栏全屏/退出全屏，按 Esc 键退出全屏，并正确渲染代码块结构', async () => {
    const plainNote = {
      id: 'note-plain-fullscreen-1',
      userId: 'u-1',
      folderId: null,
      title: '富文本全屏与代码块测试',
      content: '<pre><code>const a = 1;\nconsole.log(a);</code></pre>',
      format: 'plain' as const,
      isPinned: false,
      pinnedAt: null,
      sortOrder: 0,
      createdAt: 100,
      updatedAt: 100
    }

    vi.spyOn(foldersApi, 'list').mockResolvedValue({ folders: [] })
    vi.spyOn(notesApi, 'list').mockResolvedValue({ notes: [plainNote] })
    vi.spyOn(filesApi, 'listByNote').mockResolvedValue({ attachments: [] })

    const pinia = createPinia()
    setActivePinia(pinia)
    const noteStore = useNoteStore()
    await noteStore.loadWorkspace()

    const wrapper = mount(NoteEditor, {
      attachTo: document.body,
      global: { plugins: [pinia, i18n, ElementPlus] }
    })
    await flushPromises()

    const tiptapWrapper = wrapper.find('[data-testid="candy-tiptap-editor"]')
    expect(tiptapWrapper.exists()).toBe(true)
    expect(tiptapWrapper.classes()).not.toContain('fixed')

    // 1. 验证代码块结构
    const preEl = wrapper.find('.candy-tiptap-content pre')
    expect(preEl.exists()).toBe(true)
    expect(preEl.text()).toContain('const a = 1;')

    // 2. 点击工具栏的全屏按钮进入全屏模式
    const fullscreenBtn = wrapper.find('[data-testid="tiptap-toggle-fullscreen"]')
    expect(fullscreenBtn.exists()).toBe(true)
    expect(fullscreenBtn.text()).toContain('全屏')

    await fullscreenBtn.trigger('click')
    await flushPromises()

    // 验证全屏类名生效
    expect(tiptapWrapper.classes()).toContain('fixed')
    expect(tiptapWrapper.classes()).toContain('inset-0')
    expect(tiptapWrapper.classes()).toContain('z-50')
    expect(fullscreenBtn.text()).toContain('退出全屏')

    // 3. 再次点击退出全屏
    await fullscreenBtn.trigger('click')
    await flushPromises()
    expect(tiptapWrapper.classes()).not.toContain('fixed')
    expect(fullscreenBtn.text()).toContain('全屏')

    // 4. 进入全屏后，按下 Escape 键应退出全屏
    await fullscreenBtn.trigger('click')
    await flushPromises()
    expect(tiptapWrapper.classes()).toContain('fixed')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(tiptapWrapper.classes()).not.toContain('fixed')
    expect(fullscreenBtn.text()).toContain('全屏')

    wrapper.unmount()
  })

  it('Tiptap 富文本编辑器中的图片应支持自由调整大小、快捷预设尺寸、对齐切换与删除', async () => {
    const plainNote = {
      id: 'note-plain-image-resize-1',
      userId: 'u-1',
      folderId: null,
      title: '富文本图片缩放测试',
      content: '<p>前文段落</p><img src="/api/files/sample.png" alt="样例图">',
      format: 'plain' as const,
      isPinned: false,
      pinnedAt: null,
      sortOrder: 0,
      createdAt: 100,
      updatedAt: 100
    }

    vi.spyOn(foldersApi, 'list').mockResolvedValue({ folders: [] })
    vi.spyOn(notesApi, 'list').mockResolvedValue({ notes: [plainNote] })
    vi.spyOn(filesApi, 'listByNote').mockResolvedValue({ attachments: [] })

    const pinia = createPinia()
    setActivePinia(pinia)
    const noteStore = useNoteStore()
    await noteStore.loadWorkspace()

    const wrapper = mount(NoteEditor, {
      attachTo: document.body,
      global: { plugins: [pinia, i18n, ElementPlus] }
    })
    await flushPromises()

    // 1. 验证图片节点和外层盒子渲染
    const imageBox = wrapper.find('[data-testid="candy-resizable-image-box"]')
    expect(imageBox.exists()).toBe(true)
    const imgEl = wrapper.find('[data-testid="candy-tiptap-image-el"]')
    expect(imgEl.exists()).toBe(true)
    expect(imgEl.attributes('src')).toBe('/api/files/sample.png')

    // 2. 点击图片唤起缩放控制工具栏与拖拽手柄
    await imgEl.trigger('click')
    await flushPromises()

    const imageToolbar = wrapper.find('[data-testid="candy-image-toolbar"]')
    expect(imageToolbar.exists()).toBe(true)
    expect(wrapper.find('[data-testid="resize-handle-right"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="resize-handle-se"]').exists()).toBe(true)

    // 3. 点击 50% 快捷尺寸预设
    const preset50Btn = wrapper.find('[data-testid="size-preset-50%"]')
    expect(preset50Btn.exists()).toBe(true)
    await preset50Btn.trigger('click')
    await flushPromises()

    // 验证盒子宽度与 HTML 序列化结果已更新为 50%
    expect(imageBox.attributes('style')).toContain('width: 50%')
    const tiptapComp = wrapper.findComponent({ name: 'TiptapEditor' })
    const htmlAfter50 = (tiptapComp.vm as any).editor?.getHTML()
    expect(htmlAfter50).toContain('width="50%"')
    expect(htmlAfter50).toContain('width: 50%')

    // 4. 点击 25% 快捷尺寸预设
    const preset25Btn = wrapper.find('[data-testid="size-preset-25%"]')
    await preset25Btn.trigger('click')
    await flushPromises()
    expect(imageBox.attributes('style')).toContain('width: 25%')
    expect((tiptapComp.vm as any).editor?.getHTML()).toContain('width="25%"')

    // 5. 点击居左对齐按钮
    const alignLeftBtn = wrapper.find('[data-testid="align-left-btn"]')
    await alignLeftBtn.trigger('click')
    await flushPromises()
    const container = wrapper.find('.candy-resizable-image-container')
    expect(container.classes()).toContain('justify-start')
    expect((tiptapComp.vm as any).editor?.getHTML()).toContain('data-alignment="left"')

    // 6. 测试鼠标拖拽缩放手柄
    const handleRight = wrapper.find('[data-testid="resize-handle-right"]')
    handleRight.trigger('mousedown', { clientX: 200 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 350 }))
    await flushPromises()
    window.dispatchEvent(new MouseEvent('mouseup'))
    await flushPromises()

    // 7. 测试删除图片按钮
    const deleteBtn = wrapper.find('[data-testid="delete-image-btn"]')
    expect(deleteBtn.exists()).toBe(true)
    await deleteBtn.trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="candy-resizable-image-box"]').exists()).toBe(false)
    expect((tiptapComp.vm as any).editor?.getHTML()).not.toContain('sample.png')

    wrapper.unmount()
  })

  it('无论 Markdown 笔记还是普通文本笔记，即使存在附件数据，编辑器底部均不渲染“笔记 R2 图片附件”一栏', async () => {
    const markdownNote = {
      id: 'note-attachments-test-1',
      userId: 'u-1',
      folderId: null,
      title: '附件栏移除测试',
      content: '# 标题\n\n![图片](/api/files/test.png)',
      format: 'markdown' as const,
      isPinned: false,
      pinnedAt: null,
      sortOrder: 0,
      createdAt: 100,
      updatedAt: 100
    }

    const mockAttachments = [
      {
        id: 'att-1',
        noteId: 'note-attachments-test-1',
        userId: 'u-1',
        filename: 'test.png',
        key: 'users/u-1/test.png',
        url: '/api/files/test.png',
        size: 1024,
        mimeType: 'image/png',
        createdAt: 100
      }
    ]

    vi.spyOn(foldersApi, 'list').mockResolvedValue({ folders: [] })
    vi.spyOn(notesApi, 'list').mockResolvedValue({ notes: [markdownNote] })
    vi.spyOn(filesApi, 'listByNote').mockResolvedValue({ attachments: mockAttachments })

    const pinia = createPinia()
    setActivePinia(pinia)
    const noteStore = useNoteStore()
    await noteStore.loadWorkspace()

    const wrapper = mount(NoteEditor, {
      attachTo: document.body,
      global: { plugins: [pinia, i18n, ElementPlus] }
    })
    await flushPromises()

    // 验证 store 中即使有附件数据，编辑器中也不渲染 R2 附件列表条
    expect(noteStore.attachments.length).toBe(1)
    expect(wrapper.text()).not.toContain('笔记 R2 图片附件')
    expect(wrapper.text()).not.toContain('R2 Image Attachments')

    // 切换为 plain 格式也同样不渲染
    noteStore.activeNote!.format = 'plain'
    await flushPromises()
    expect(wrapper.text()).not.toContain('笔记 R2 图片附件')
    expect(wrapper.text()).not.toContain('R2 Image Attachments')

    wrapper.unmount()
  })

  it('Markdown 笔记在纯预览模式下不应显示“插入图片”按钮，仅在编辑/分栏模式下显示', async () => {
    const markdownNote = {
      id: 'note-md-preview-mode-1',
      userId: 'u-1',
      folderId: null,
      title: '预览模式测试',
      content: '# 标题\n\n正文内容',
      format: 'markdown' as const,
      isPinned: false,
      pinnedAt: null,
      sortOrder: 0,
      createdAt: 100,
      updatedAt: 100
    }

    vi.spyOn(foldersApi, 'list').mockResolvedValue({ folders: [] })
    vi.spyOn(notesApi, 'list').mockResolvedValue({ notes: [markdownNote] })
    vi.spyOn(filesApi, 'listByNote').mockResolvedValue({ attachments: [] })

    const pinia = createPinia()
    setActivePinia(pinia)
    const noteStore = useNoteStore()
    await noteStore.loadWorkspace()

    noteStore.setMarkdownViewMode('split')

    const wrapper = mount(NoteEditor, {
      attachTo: document.body,
      global: { plugins: [pinia, i18n, ElementPlus] }
    })
    await flushPromises()

    // 1. 分栏模式下存在插入图片按钮
    expect(wrapper.find('[data-testid="markdown-upload-image-btn"]').exists()).toBe(true)

    // 2. 切换至纯编辑模式，插入图片按钮依然存在
    noteStore.setMarkdownViewMode('edit')
    await flushPromises()
    expect(wrapper.find('[data-testid="markdown-upload-image-btn"]').exists()).toBe(true)

    // 3. 切换至纯预览模式，插入图片按钮以及快捷排版按钮均不应存在
    noteStore.setMarkdownViewMode('preview')
    await flushPromises()
    expect(wrapper.find('[data-testid="markdown-upload-image-btn"]').exists()).toBe(false)
    expect(wrapper.find('button[title^="一级标题"]').exists()).toBe(false)

    wrapper.unmount()
  })

  it('Markdown 笔记在纯预览模式下右侧应展示目录 (TOC)，且支持折叠与展开', async () => {
    const mdWithHeadings = {
      id: 'note-toc-test-1',
      userId: 'u-1',
      folderId: null,
      title: 'TOC目录测试笔记',
      content: '# 第一章 核心介绍\n\n正文描述...\n\n## 1.1 架构设计\n\n### 1.1.1 细节规范\n\n# 第二章 运维部署',
      format: 'markdown' as const,
      isPinned: false,
      pinnedAt: null,
      sortOrder: 0,
      createdAt: 100,
      updatedAt: 100
    }

    vi.spyOn(foldersApi, 'list').mockResolvedValue({ folders: [] })
    vi.spyOn(notesApi, 'list').mockResolvedValue({ notes: [mdWithHeadings] })
    vi.spyOn(filesApi, 'listByNote').mockResolvedValue({ attachments: [] })

    const pinia = createPinia()
    setActivePinia(pinia)
    const noteStore = useNoteStore()
    await noteStore.loadWorkspace()

    // 1. 分栏模式与纯编辑模式下不应渲染目录侧边栏
    noteStore.setMarkdownViewMode('split')
    const wrapper = mount(NoteEditor, {
      attachTo: document.body,
      global: { plugins: [pinia, i18n, ElementPlus] }
    })
    await flushPromises()
    expect(wrapper.find('[data-testid="markdown-toc-sidebar"]').exists()).toBe(false)

    noteStore.setMarkdownViewMode('edit')
    await flushPromises()
    expect(wrapper.find('[data-testid="markdown-toc-sidebar"]').exists()).toBe(false)

    // 2. 切换到纯预览模式，右侧目录侧边栏应自动出现并正确解析各级标题
    noteStore.setMarkdownViewMode('preview')
    await flushPromises()
    const tocSidebar = wrapper.find('[data-testid="markdown-toc-sidebar"]')
    expect(tocSidebar.exists()).toBe(true)

    // 检查目录条目内容
    const item0 = wrapper.find('[data-testid="toc-item-heading-0"]')
    const item1 = wrapper.find('[data-testid="toc-item-heading-1"]')
    const item2 = wrapper.find('[data-testid="toc-item-heading-2"]')
    const item3 = wrapper.find('[data-testid="toc-item-heading-3"]')
    expect(item0.exists()).toBe(true)
    expect(item0.text()).toContain('第一章 核心介绍')
    expect(item1.text()).toContain('1.1 架构设计')
    expect(item2.text()).toContain('1.1.1 细节规范')
    expect(item3.text()).toContain('第二章 运维部署')

    // 3. 点击折叠按钮，目录应收起为细条（显示展开按钮）
    const collapseBtn = wrapper.find('[data-testid="collapse-toc-btn"]')
    expect(collapseBtn.exists()).toBe(true)
    await collapseBtn.trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="expand-toc-btn"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="collapse-toc-btn"]').exists()).toBe(false)

    // 4. 点击展开按钮，目录应恢复展开
    const expandBtn = wrapper.find('[data-testid="expand-toc-btn"]')
    await expandBtn.trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="collapse-toc-btn"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="expand-toc-btn"]').exists()).toBe(false)

    // 5. 点击目录项应触发平滑滚动且高亮对应目录项
    const scrollMock = vi.fn()
    window.HTMLElement.prototype.scrollIntoView = scrollMock
    const activeItem1 = wrapper.find('[data-testid="toc-item-heading-1"]')
    await activeItem1.trigger('click')
    await flushPromises()
    expect(scrollMock).toHaveBeenCalled()
    expect(wrapper.find('[data-testid="toc-item-heading-1"]').classes()).toContain('text-rose-600')

    // 点击最后的索引项（即使末尾标题相距较近），也必须高亮在最后的索引上
    const activeItem3 = wrapper.find('[data-testid="toc-item-heading-3"]')
    await activeItem3.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="toc-item-heading-3"]').classes()).toContain('text-rose-600')
    expect(wrapper.find('[data-testid="toc-item-heading-1"]').classes()).not.toContain('text-rose-600')

    wrapper.unmount()
  })

  it('Markdown 纯预览模式下正文末尾多个索引靠得很近时，点击最后的索引应正确保持高亮在最后的索引上', async () => {
    const mdWithCloseHeadings = {
      id: 'note-toc-close-headings-test',
      userId: 'u-1',
      folderId: null,
      title: '末尾临近标题高亮测试',
      content: '# 导言篇章\n\n大量正文内容...\n\n# 附录一\n\n附录一简述\n\n# 附录二\n\n附录二简述\n\n# 附录三\n\n结束',
      format: 'markdown' as const,
      isPinned: false,
      pinnedAt: null,
      sortOrder: 0,
      createdAt: 100,
      updatedAt: 100
    }

    vi.spyOn(foldersApi, 'list').mockResolvedValue({ folders: [] })
    vi.spyOn(notesApi, 'list').mockResolvedValue({ notes: [mdWithCloseHeadings] })
    vi.spyOn(filesApi, 'listByNote').mockResolvedValue({ attachments: [] })

    const pinia = createPinia()
    setActivePinia(pinia)
    const noteStore = useNoteStore()
    await noteStore.loadWorkspace()
    noteStore.setMarkdownViewMode('preview')

    const wrapper = mount(NoteEditor, {
      attachTo: document.body,
      global: { plugins: [pinia, i18n, ElementPlus] }
    })
    await flushPromises()

    const scrollMock = vi.fn()
    window.HTMLElement.prototype.scrollIntoView = scrollMock

    const itemLast = wrapper.find('[data-testid="toc-item-heading-3"]')
    const itemPrev = wrapper.find('[data-testid="toc-item-heading-2"]')
    expect(itemLast.exists()).toBe(true)
    expect(itemPrev.exists()).toBe(true)

    // 点击末尾的最后一个索引
    await itemLast.trigger('click')
    await flushPromises()
    expect(scrollMock).toHaveBeenCalled()
    expect(wrapper.find('[data-testid="toc-item-heading-3"]').classes()).toContain('text-rose-600')
    expect(wrapper.find('[data-testid="toc-item-heading-2"]').classes()).not.toContain('text-rose-600')

    // 模拟预览容器在点击滚动过程中触发 scroll 事件（例如末尾标题未到达视口顶部时）
    const previewContainer = wrapper.find('.candy-markdown-body')
    expect(previewContainer.exists()).toBe(true)
    // 预览容器应带有 pb-[50vh] 允许末尾内容滚动到视口顶部
    expect(previewContainer.classes()).toContain('pb-[50vh]')

    await previewContainer.trigger('scroll')
    await flushPromises()
    // 由于程序化滚动保护与滚动到底部逻辑，最后索引高亮不会被错误跳回前置标题
    expect(wrapper.find('[data-testid="toc-item-heading-3"]').classes()).toContain('text-rose-600')

    // 用户手动滚轮交互测试：释放程序化保护
    await previewContainer.trigger('wheel')
    await flushPromises()

    wrapper.unmount()
  })

  it('Markdown 纯编辑模式下字符统计后应展示全屏编辑按钮，并支持点击与 Esc 键切换全屏', async () => {
    const mdNote = {
      id: 'note-md-fullscreen-test',
      userId: 'u-1',
      folderId: null,
      title: 'Markdown 全屏测试笔记',
      content: '# 标题\n\n测试内容',
      format: 'markdown' as const,
      isPinned: false,
      pinnedAt: null,
      sortOrder: 0,
      createdAt: 100,
      updatedAt: 100
    }

    vi.spyOn(foldersApi, 'list').mockResolvedValue({ folders: [] })
    vi.spyOn(notesApi, 'list').mockResolvedValue({ notes: [mdNote] })
    vi.spyOn(filesApi, 'listByNote').mockResolvedValue({ attachments: [] })

    const pinia = createPinia()
    setActivePinia(pinia)
    const noteStore = useNoteStore()
    await noteStore.loadWorkspace()

    // 1. 分栏模式与纯预览模式下不应显示工具栏内的全屏编辑按钮
    noteStore.setMarkdownViewMode('split')
    const wrapper = mount(NoteEditor, {
      attachTo: document.body,
      global: { plugins: [pinia, i18n, ElementPlus] }
    })
    await flushPromises()
    expect(wrapper.find('[data-testid="markdown-toggle-fullscreen"]').exists()).toBe(false)

    noteStore.setMarkdownViewMode('preview')
    await flushPromises()
    expect(wrapper.find('[data-testid="markdown-toggle-fullscreen"]').exists()).toBe(false)
    expect(wrapper.find('textarea').exists()).toBe(false)
    expect(wrapper.find('.candy-markdown-body').exists()).toBe(true)
    expect(wrapper.find('[data-testid="markdown-toc-sidebar"]').exists()).toBe(true)

    // 2. 切换到纯编辑模式，字符统计后面应展示全屏编辑按钮
    noteStore.setMarkdownViewMode('edit')
    await flushPromises()

    const fullscreenBtn = wrapper.find('[data-testid="markdown-toggle-fullscreen"]')
    expect(fullscreenBtn.exists()).toBe(true)
    expect(fullscreenBtn.text()).toContain('全屏')

    const mdEditorWrapper = wrapper.find('[data-testid="markdown-editor-wrapper"]')
    expect(mdEditorWrapper.exists()).toBe(true)
    expect(mdEditorWrapper.classes()).not.toContain('fixed')

    // 3. 点击全屏编辑按钮进入全屏
    await fullscreenBtn.trigger('click')
    await flushPromises()

    expect(mdEditorWrapper.classes()).toContain('fixed')
    expect(mdEditorWrapper.classes()).toContain('inset-0')
    expect(mdEditorWrapper.classes()).toContain('z-50')
    expect(wrapper.find('[data-testid="markdown-toggle-fullscreen"]').text()).toContain('退出全屏')
    const textarea = wrapper.find('textarea')
    expect(textarea.classes()).toContain('max-w-4xl')
    expect(textarea.classes()).toContain('mx-auto')

    // 4. 再次点击退出全屏
    await wrapper.find('[data-testid="markdown-toggle-fullscreen"]').trigger('click')
    await flushPromises()

    expect(mdEditorWrapper.classes()).not.toContain('fixed')
    expect(wrapper.find('[data-testid="markdown-toggle-fullscreen"]').text()).toContain('全屏')

    // 5. 再次进入全屏后，按下 Escape 键应退出全屏
    await wrapper.find('[data-testid="markdown-toggle-fullscreen"]').trigger('click')
    await flushPromises()
    expect(mdEditorWrapper.classes()).toContain('fixed')

    const escEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    window.dispatchEvent(escEvent)
    await flushPromises()

    expect(mdEditorWrapper.classes()).not.toContain('fixed')
    expect(wrapper.find('[data-testid="markdown-toggle-fullscreen"]').text()).toContain('全屏')

    wrapper.unmount()
  })

  it('NoteList 笔记列表在拖拽排序时应渲染高可见度的拖拽插入指示线', async () => {
    const note1 = {
      id: 'note-drag-1',
      userId: 'u-1',
      folderId: null,
      title: '笔记 1',
      content: '内容 1',
      format: 'markdown' as const,
      isPinned: false,
      pinnedAt: null,
      sortOrder: 0,
      createdAt: 100,
      updatedAt: 100
    }
    const note2 = {
      id: 'note-drag-2',
      userId: 'u-1',
      folderId: null,
      title: '笔记 2',
      content: '内容 2',
      format: 'markdown' as const,
      isPinned: false,
      pinnedAt: null,
      sortOrder: 1,
      createdAt: 200,
      updatedAt: 200
    }

    vi.spyOn(foldersApi, 'list').mockResolvedValue({ folders: [] })
    vi.spyOn(notesApi, 'list').mockResolvedValue({ notes: [note1, note2] })
    vi.spyOn(filesApi, 'listByNote').mockResolvedValue({ attachments: [] })

    const pinia = createPinia()
    setActivePinia(pinia)
    const noteStore = useNoteStore()
    await noteStore.loadWorkspace()

    const wrapper = mount(NoteList, {
      attachTo: document.body,
      global: { plugins: [pinia, i18n, ElementPlus] }
    })
    await flushPromises()

    const noteCards = wrapper.findAll('[draggable="true"]')
    expect(noteCards.length).toBe(2)

    // 模拟拖拽 note1 到 note2 上半部 (before)
    await noteCards[0].trigger('dragstart', {
      dataTransfer: {
        setData: vi.fn(),
        effectAllowed: 'move'
      }
    })

    const targetEl = noteCards[1].element as HTMLElement
    vi.spyOn(targetEl, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      bottom: 200,
      height: 100,
      left: 0,
      right: 200,
      width: 200,
      x: 0,
      y: 100,
      toJSON: () => {}
    })

    await noteCards[1].trigger('dragover', {
      clientY: 120, // 距离 top 20 < 50 => 'before'
      dataTransfer: {
        types: ['application/x-candy-note-id']
      }
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="drag-indicator-before"]').exists()).toBe(true)

    // 模拟移动到下半部 (after)
    await noteCards[1].trigger('dragover', {
      clientY: 180, // 距离 top 80 > 50 => 'after'
      dataTransfer: {
        types: ['application/x-candy-note-id']
      }
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="drag-indicator-after"]').exists()).toBe(true)

    wrapper.unmount()
  })

  it('NoteEditor 应在顶部工具栏渲染分享按钮，并在点击时弹出分享配置对话框', async () => {
    const testNote = {
      id: 'note-share-test',
      userId: 'u-1',
      folderId: null,
      title: '公开分享测试笔记',
      content: '# 欢迎阅读公开分享内容',
      format: 'markdown' as const,
      isPinned: false,
      pinnedAt: null,
      sortOrder: 0,
      createdAt: 1000,
      updatedAt: 1000
    }

    vi.spyOn(foldersApi, 'list').mockResolvedValue({ folders: [] })
    vi.spyOn(notesApi, 'list').mockResolvedValue({ notes: [testNote] })
    vi.spyOn(filesApi, 'listByNote').mockResolvedValue({ attachments: [] })
    vi.spyOn(notesApi, 'getShare').mockResolvedValue({
      share: {
        id: 'share-1',
        noteId: testNote.id,
        userId: 'u-1',
        shareCode: 'abc123xyz0',
        isEnabled: true,
        hasPassword: false,
        expiresAt: null,
        viewCount: 5,
        createdAt: 1000,
        updatedAt: 1000,
        shareUrl: 'http://localhost/share/abc123xyz0'
      }
    })

    const pinia = createPinia()
    setActivePinia(pinia)
    const noteStore = useNoteStore()
    await noteStore.loadWorkspace()

    const wrapper = mount(NoteEditor, {
      attachTo: document.body,
      global: { plugins: [pinia, i18n, ElementPlus] }
    })
    await flushPromises()

    const shareBtn = wrapper.find('[data-testid="share-note-btn"]')
    expect(shareBtn.exists()).toBe(true)

    // 点击分享按钮打开分享弹窗
    await shareBtn.trigger('click')
    await flushPromises()

    const shareDialog = document.body.querySelector('.candy-share-dialog')
    expect(shareDialog).not.toBeNull()

    wrapper.unmount()
  })

  it('NoteShareDialog 应支持配置永久/自定义有效期、设置密码保护并保存，支持复制分享链接', async () => {
    const testNote = {
      id: 'note-dialog-test',
      userId: 'u-1',
      folderId: null,
      title: '弹窗配置测试',
      content: '正文',
      format: 'markdown' as const,
      isPinned: false,
      pinnedAt: null,
      sortOrder: 0,
      createdAt: 1000,
      updatedAt: 1000
    }

    const getShareSpy = vi.spyOn(notesApi, 'getShare').mockResolvedValue({
      share: null
    })

    const saveShareSpy = vi.spyOn(notesApi, 'saveShare').mockResolvedValue({
      share: {
        id: 's-new',
        noteId: testNote.id,
        userId: 'u-1',
        shareCode: 'code789',
        isEnabled: true,
        hasPassword: true,
        expiresAt: Date.now() + 86400000,
        viewCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        shareUrl: 'http://localhost/share/code789'
      }
    })

    const pinia = createPinia()
    setActivePinia(pinia)

    const wrapper = mount(NoteShareDialog, {
      props: {
        modelValue: true,
        note: testNote
      },
      attachTo: document.body,
      global: { plugins: [pinia, i18n, ElementPlus] }
    })
    await flushPromises()
    expect(getShareSpy).toHaveBeenCalledWith(testNote.id)

    // “开启公开分享”选项默认打开且不可关闭
    const enableCard = document.body.querySelector('[data-testid="share-enabled-card"]') as HTMLElement
    expect(enableCard).not.toBeNull()
    const enableSwitch = document.body.querySelector('[data-testid="share-enabled-switch"]') as HTMLElement
    expect(enableSwitch).not.toBeNull()
    expect(enableSwitch.classList.contains('is-disabled')).toBe(true)

    // 点击该选项卡片不会关闭分享配置
    enableCard.click()
    await flushPromises()
    expect(document.body.querySelector('[data-testid="duration-1d"]')).not.toBeNull()

    // 切换为 1天 有效期
    const dayBtn = document.body.querySelector('[data-testid="duration-1d"]') as HTMLElement
    expect(dayBtn).not.toBeNull()
    dayBtn.click()
    await flushPromises()

    // 开启密码保护：应自动随机生成 4 位访问密码且直接明文显示（type="text"）
    const pwdHeader = document.body.querySelector('[data-testid="share-password-header"]') as HTMLElement
    expect(pwdHeader).not.toBeNull()
    pwdHeader.click()
    await flushPromises()

    const pwdInput = document.body.querySelector(
      '[data-testid="share-password-container"] input'
    ) as HTMLInputElement
    expect(pwdInput).not.toBeNull()
    expect(pwdInput.type).toBe('text')
    expect(pwdInput.value.length).toBe(4)

    // 支持点击重新生成密码按钮刷新 4 位随机密码
    const regenBtn = document.body.querySelector(
      '[data-testid="regenerate-password-btn"]'
    ) as HTMLButtonElement
    expect(regenBtn).not.toBeNull()
    regenBtn.click()
    await flushPromises()
    expect(pwdInput.value.length).toBe(4)

    pwdInput.value = 'secret123'
    pwdInput.dispatchEvent(new Event('input'))
    await flushPromises()

    // 点击“保存并分享”（按钮文案已升级为“保存并分享”）
    const saveBtn = document.body.querySelector('[data-testid="save-share-btn"]') as HTMLElement
    expect(saveBtn).not.toBeNull()
    expect(saveBtn.textContent).toContain('保存并分享')
    saveBtn.click()
    await flushPromises()

    expect(saveShareSpy).toHaveBeenCalledWith(
      testNote.id,
      expect.objectContaining({
        isEnabled: true,
        duration: '1d',
        hasPassword: true,
        password: 'secret123'
      })
    )

    // 校验保存后分享链接自动附带 ?password=secret123
    const shareUrlInput = (document.body.querySelector('[data-testid="share-url-input"] input') ||
      document.body.querySelector('[data-testid="share-url-input"]')) as HTMLInputElement
    expect(shareUrlInput).not.toBeNull()
    expect(shareUrlInput.value).toContain('?password=secret123')

    // “复制链接与密码”按钮已移除
    expect(document.body.querySelector('[data-testid="copy-link-and-pwd-btn"]')).toBeNull()

    // 底部“删除”按钮已升级为“删除分享”
    const disableBtn = document.body.querySelector('[data-testid="disable-share-btn"]') as HTMLElement
    expect(disableBtn).not.toBeNull()
    expect(disableBtn.textContent).toContain('删除分享')

    wrapper.unmount()

    // 验证当再次打开已设置 1h / 1d / 30d 分享有效期的笔记时，默认应正确高亮对应选项，而非错误重置为 7d
    for (const testDur of ['1h', '1d', '30d'] as const) {
      const durMs = testDur === '1h' ? 3600000 : testDur === '1d' ? 86400000 : 30 * 86400000
      const now = Date.now()
      vi.spyOn(notesApi, 'getShare').mockResolvedValueOnce({
        share: {
          id: `s-${testDur}`,
          noteId: testNote.id,
          userId: 'u-1',
          shareCode: `code-${testDur}`,
          isEnabled: true,
          hasPassword: false,
          duration: testDur,
          expiresAt: now + durMs,
          viewCount: 1,
          createdAt: now,
          updatedAt: now,
          shareUrl: `http://localhost/share/code-${testDur}`
        }
      })

      const durWrapper = mount(NoteShareDialog, {
        props: {
          modelValue: true,
          note: testNote
        },
        attachTo: document.body,
        global: { plugins: [pinia, i18n, ElementPlus] }
      })
      await flushPromises()

      const targetBtn = document.body.querySelector(`[data-testid="duration-${testDur}"]`) as HTMLElement
      expect(targetBtn).not.toBeNull()
      expect(targetBtn.className).toContain('border-rose-500')

      const sevenDayBtn = document.body.querySelector('[data-testid="duration-7d"]') as HTMLElement
      expect(sevenDayBtn.className).not.toContain('border-rose-500')

      durWrapper.unmount()
    }
  })

  it('ShareView 公开外部访问页面应支持免密访问、支持密码解锁流程、并在过期或不存在时正确显示状态提示', async () => {
    // 1. 免密公开分享页面测试
    vi.spyOn(publicShareApi, 'get').mockResolvedValueOnce({
      share: {
        shareCode: 'public123',
        title: '公开笔记标题',
        format: 'markdown',
        content: '# 公开正文\n\n- 条目一\n- 条目二',
        authorName: 'alice',
        requirePassword: false,
        expiresAt: null,
        createdAt: 1000,
        viewCount: 12
      }
    })

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/share/:shareCode', name: 'share', component: ShareView },
        { path: '/', name: 'workspace', component: { template: '<div />' } },
        { path: '/login', name: 'login', component: { template: '<div />' } }
      ]
    })
    await router.push('/share/public123')
    await router.isReady()

    const pinia = createPinia()
    setActivePinia(pinia)

    let wrapper = mount(ShareView, {
      global: { plugins: [pinia, router, i18n, ElementPlus] }
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="shared-note-article"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('公开笔记标题')
    expect(wrapper.text()).toContain('alice')
    expect(wrapper.find('.candy-markdown-body').exists()).toBe(true)
    wrapper.unmount()

    // 2. 密码保护的笔记访问与解锁测试
    vi.spyOn(publicShareApi, 'get').mockResolvedValueOnce({
      share: {
        shareCode: 'pwd456',
        title: '私密分享笔记',
        authorName: 'bob',
        requirePassword: true,
        expiresAt: null,
        createdAt: 2000,
        viewCount: 3
      }
    })
    const accessSpy = vi.spyOn(publicShareApi, 'access').mockResolvedValueOnce({
      share: {
        shareCode: 'pwd456',
        title: '私密分享笔记',
        format: 'plain',
        content: '<p>已解锁富文本内容</p>',
        authorName: 'bob',
        requirePassword: false,
        expiresAt: null,
        createdAt: 2000,
        viewCount: 4
      }
    })

    await router.push('/share/pwd456')
    await flushPromises()

    wrapper = mount(ShareView, {
      global: { plugins: [pinia, router, i18n, ElementPlus] }
    })
    await flushPromises()

    // 应展示密码输入框
    expect(wrapper.find('[data-testid="share-password-box"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="shared-note-article"]').exists()).toBe(false)

    // 输入密码并点击解锁
    const pwdInput = wrapper.find('input[type="password"]')
    expect(pwdInput.exists()).toBe(true)
    await pwdInput.setValue('my-password')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(accessSpy).toHaveBeenCalledWith('pwd456', 'my-password')
    expect(wrapper.find('[data-testid="shared-note-article"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('私密分享笔记')
    wrapper.unmount()

    // 3. 过期分享（410）状态测试
    vi.spyOn(publicShareApi, 'get').mockRejectedValueOnce(
      new ApiRequestError('SHARE_EXPIRED', '分享链接已到期失效', 410)
    )
    await router.push('/share/expired999')
    await flushPromises()

    wrapper = mount(ShareView, {
      global: { plugins: [pinia, router, i18n, ElementPlus] }
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="share-expired"]').exists()).toBe(true)
    wrapper.unmount()

    // 4. URL 中带有 ?password=direct-pwd 直接免验证查看笔记正文
    vi.spyOn(publicShareApi, 'get').mockImplementation(async (code, pwd) => {
      if (pwd === 'direct-pwd') {
        return {
          ok: true,
          requirePassword: false,
          note: {
            shareCode: 'urlpwd789',
            title: 'URL免密直达笔记',
            format: 'markdown',
            content: '直接展现无需输入',
            authorName: 'alice',
            requirePassword: false,
            expiresAt: null,
            createdAt: 3000,
            viewCount: 10
          }
        }
      }
      return {
        ok: true,
        requirePassword: true,
        note: {
          shareCode: 'urlpwd789',
          title: 'URL免密直达笔记',
          authorName: 'alice',
          requirePassword: true,
          expiresAt: null,
          createdAt: 3000,
          viewCount: 9
        }
      }
    })

    await router.push('/share/urlpwd789?password=direct-pwd')
    await flushPromises()

    wrapper = mount(ShareView, {
      global: { plugins: [pinia, router, i18n, ElementPlus] }
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="shared-note-article"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="share-password-box"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('URL免密直达笔记')
    expect(wrapper.text()).toContain('直接展现无需输入')
    wrapper.unmount()
  })
})
