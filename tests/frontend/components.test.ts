import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElMessageBox } from 'element-plus'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { adminApi } from '@/api/admin'
import { authApi } from '@/api/auth'
import { filesApi } from '@/api/files'
import { foldersApi } from '@/api/folders'
import { notesApi } from '@/api/notes'
import { ApiRequestError } from '@/api/client'
import AppHeader from '@/components/layout/AppHeader.vue'
import FolderSidebar from '@/components/notes/FolderSidebar.vue'
import NoteEditor from '@/components/notes/NoteEditor.vue'
import NoteList from '@/components/notes/NoteList.vue'
import { i18n } from '@/i18n'
import { useAuthStore } from '@/stores/auth'
import { useLayoutStore } from '@/stores/layout'
import { useNoteStore } from '@/stores/note'
import AdminView from '@/views/AdminView.vue'
import LoginView from '@/views/LoginView.vue'

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

    // 点击全屏按钮进入全屏模式
    await wrapper.find('[data-testid="toggle-fullscreen"]').trigger('click')
    expect(layoutStore.isEditorFullscreen).toBe(true)
    expect(editorMain.classes()).toContain('fixed')
    expect(editorMain.classes()).toContain('z-50')

    // 触发 Esc 键退出全屏模式
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(layoutStore.isEditorFullscreen).toBe(false)
    expect(editorMain.classes()).not.toContain('fixed')

    // 再次全屏后点击移动端返回列表按钮，应同时退出全屏并切回 list 视图
    await wrapper.find('[data-testid="toggle-fullscreen"]').trigger('click')
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
})
