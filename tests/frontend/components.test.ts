import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { authApi } from '@/api/auth'
import { filesApi } from '@/api/files'
import { foldersApi } from '@/api/folders'
import { notesApi } from '@/api/notes'
import NoteEditor from '@/components/notes/NoteEditor.vue'
import { i18n } from '@/i18n'
import { useNoteStore } from '@/stores/note'
import LoginView from '@/views/LoginView.vue'

/**
 * 核心 UI 组件集成测试
 * 覆盖登录页（无注册入口、图片验证码加载与点击刷新、30天自动登录勾选）
 * 以及笔记编辑器（Markdown 实时边写边预览、格式切换）
 */
describe('Core Vue Components', () => {
  beforeEach(() => {
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

    // 修改 Markdown 内容时右侧预览应同步更新
    await textarea.setValue('## 更新后的副标题\n\n**加粗内容**')
    expect(wrapper.find('.candy-markdown-body').html()).toContain('<h2>更新后的副标题</h2>')
    expect(wrapper.find('.candy-markdown-body').html()).toContain('<strong>加粗内容</strong>')

    // 切换为普通文本模式后应关闭 Markdown 预览分栏并调用保存接口
    const plainBtn = wrapper
      .findAll('button')
      .find((b) => b.text().trim() === '普通文本')
    expect(plainBtn).toBeDefined()
    await plainBtn!.trigger('click')
    expect(updateSpy).toHaveBeenCalled()
    expect(wrapper.find('.candy-markdown-body').exists()).toBe(false)
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
  })
})
