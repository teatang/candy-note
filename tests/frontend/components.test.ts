import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
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

    // 切换为普通文本模式后应关闭 Markdown 预览分栏并调用保存接口
    const plainBtn = wrapper
      .findAll('button')
      .find((b) => b.text().trim() === '普通文本')
    expect(plainBtn).toBeDefined()
    await plainBtn!.trigger('click')
    expect(updateSpy).toHaveBeenCalled()
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
})
