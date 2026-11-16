<script setup lang="ts">
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import StarterKit from '@tiptap/starter-kit'
import { Editor, EditorContent } from '@tiptap/vue-3'
import { ElMessage, ElMessageBox } from 'element-plus'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

/**
 * Tiptap 富文本编辑器组件
 * - 替代原简陋的普通文本 textarea，提供所见即所得的富文本编辑体验
 * - 扩展支持标题、粗体、斜体、删除线、行内代码、引用块、代码块、列表、分割线
 * - 支持插入链接、插入/拖入/粘贴图片上传至 Cloudflare R2
 * - 适配糖果笔记的浅色与深色（dark mode）主题
 */
const props = withDefaults(
  defineProps<{
    modelValue?: string
    placeholder?: string
    editable?: boolean
  }>(),
  {
    modelValue: '',
    placeholder: '',
    editable: true
  }
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'input'): void
  (e: 'upload-image-request'): void
  (e: 'drop-files', files: File[]): void
  (e: 'paste-files', files: File[]): void
  (e: 'fullscreen-change', isFullscreen: boolean): void
}>()

const editor = ref<Editor | null>(null)
const fallbackTextareaRef = ref<HTMLTextAreaElement | null>(null)
const isFullscreen = ref(false)

function toggleFullscreen() {
  isFullscreen.value = !isFullscreen.value
  emit('fullscreen-change', isFullscreen.value)
}

function handleWindowKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && isFullscreen.value) {
    e.preventDefault()
    e.stopPropagation()
    isFullscreen.value = false
    emit('fullscreen-change', false)
  }
}

function handleFallbackInput(e: Event) {
  const target = e.target as HTMLTextAreaElement
  const val = target.value
  emit('update:modelValue', val)
  emit('input')
  if (editor.value) {
    editor.value.commands.setContent(val || '', false)
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleWindowKeydown)
  editor.value = new Editor({
    content: props.modelValue || '',
    editable: props.editable,
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3]
        },
        link: false
      }),
      Image.configure({
        inline: false,
        allowBase64: true,
        HTMLAttributes: {
          class: 'candy-tiptap-image'
        }
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          target: '_blank',
          rel: 'noopener noreferrer'
        }
      }),
      Placeholder.configure({
        placeholder: props.placeholder || '开始输入富文本内容...'
      })
    ],
    editorProps: {
      attributes: {
        class:
          'candy-tiptap-content min-h-0 h-full w-full outline-none focus:outline-none p-4 sm:p-6 text-slate-800 dark:text-slate-200'
      },
      handleDrop: (_view, event) => {
        const files = event.dataTransfer?.files
        if (files && files.length > 0) {
          const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'))
          if (imageFiles.length > 0) {
            event.preventDefault()
            emit('drop-files', imageFiles)
            return true
          }
        }
        return false
      },
      handlePaste: (_view, event) => {
        const items = event.clipboardData?.items
        if (!items) return false
        const imageFiles: File[] = []
        for (const item of items) {
          if (item.kind === 'file' && item.type.startsWith('image/')) {
            const f = item.getAsFile()
            if (f) imageFiles.push(f)
          }
        }
        if (imageFiles.length > 0) {
          event.preventDefault()
          emit('paste-files', imageFiles)
          return true
        }
        return false
      }
    },
    onUpdate: ({ editor: ed }) => {
      const html = ed.getHTML()
      emit('update:modelValue', html)
      emit('input')
    }
  })
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleWindowKeydown)
  editor.value?.destroy()
  editor.value = null
})

// 防双向绑定回环与保护光标位置
watch(
  () => props.modelValue,
  (val) => {
    if (fallbackTextareaRef.value && fallbackTextareaRef.value.value !== (val || '')) {
      fallbackTextareaRef.value.value = val || ''
    }
    if (!editor.value) return
    const currentHtml = editor.value.getHTML()
    const nextHtml = val || ''
    if (currentHtml !== nextHtml) {
      editor.value.commands.setContent(nextHtml, false)
    }
  }
)

watch(
  () => props.editable,
  (val) => {
    editor.value?.setEditable(val)
  }
)

function insertImage(url: string, alt = '') {
  if (!editor.value) return
  editor.value.chain().focus().setImage({ src: url, alt }).run()
}

async function handleSetLink() {
  if (!editor.value) return
  const prevUrl = editor.value.getAttributes('link').href || ''

  try {
    const { value: url } = await ElMessageBox.prompt('请输入网页链接 URL', '插入链接', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      inputValue: prevUrl,
      inputPattern: /^(https?:\/\/|\/|mailto:).+/,
      inputErrorMessage: '请输入以 http:// 或 https:// 开头的合法网址'
    })

    if (!url) {
      editor.value.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }

    editor.value.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  } catch {
    // 用户取消输入
  }
}

const textCharCount = computed(() => {
  if (!editor.value) return 0
  return editor.value.getText().length
})

defineExpose({
  editor,
  isFullscreen,
  toggleFullscreen,
  insertImage,
  focus: () => editor.value?.commands.focus()
})
</script>

<template>
  <div
    data-testid="candy-tiptap-editor"
    class="candy-tiptap-wrapper flex flex-col min-h-0 w-full"
    :class="
      isFullscreen
        ? 'fixed inset-0 z-50 h-screen w-screen bg-white dark:bg-slate-950'
        : 'flex-1 overflow-hidden'
    "
  >
    <!-- 富文本格式工具栏 -->
    <div
      v-if="editor"
      class="candy-tiptap-toolbar flex flex-wrap items-center gap-1 border-b border-slate-200/80 bg-slate-50/60 px-3 py-1.5 sm:px-5 sm:py-2 dark:border-slate-800 dark:bg-slate-900/50"
    >
      <!-- 标题级别按钮组 -->
      <button
        type="button"
        class="rounded px-2 py-1 text-xs font-semibold transition"
        :class="
          editor.isActive('paragraph')
            ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/25 dark:text-rose-300'
            : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800'
        "
        title="正文段落"
        @click="editor?.chain().focus().setParagraph().run()"
      >
        P
      </button>
      <button
        type="button"
        class="rounded px-2 py-1 text-xs font-bold transition"
        :class="
          editor.isActive('heading', { level: 1 })
            ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/25 dark:text-rose-300'
            : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800'
        "
        title="一级标题"
        @click="editor?.chain().focus().toggleHeading({ level: 1 }).run()"
      >
        H1
      </button>
      <button
        type="button"
        class="rounded px-2 py-1 text-xs font-bold transition"
        :class="
          editor.isActive('heading', { level: 2 })
            ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/25 dark:text-rose-300'
            : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800'
        "
        title="二级标题"
        @click="editor?.chain().focus().toggleHeading({ level: 2 }).run()"
      >
        H2
      </button>
      <button
        type="button"
        class="rounded px-2 py-1 text-xs font-bold transition"
        :class="
          editor.isActive('heading', { level: 3 })
            ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/25 dark:text-rose-300'
            : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800'
        "
        title="三级标题"
        @click="editor?.chain().focus().toggleHeading({ level: 3 }).run()"
      >
        H3
      </button>

      <span class="mx-1 h-3.5 w-[1px] bg-slate-200 dark:bg-slate-700" />

      <!-- 行内字体修饰 -->
      <button
        type="button"
        class="rounded px-2 py-1 text-xs font-bold transition"
        :class="
          editor.isActive('bold')
            ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/25 dark:text-rose-300'
            : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800'
        "
        title="加粗 (Ctrl/Cmd+B)"
        @click="editor?.chain().focus().toggleBold().run()"
      >
        B
      </button>
      <button
        type="button"
        class="rounded px-2 py-1 text-xs italic font-serif transition"
        :class="
          editor.isActive('italic')
            ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/25 dark:text-rose-300'
            : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800'
        "
        title="斜体 (Ctrl/Cmd+I)"
        @click="editor?.chain().focus().toggleItalic().run()"
      >
        I
      </button>
      <button
        type="button"
        class="rounded px-2 py-1 text-xs line-through transition"
        :class="
          editor.isActive('strike')
            ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/25 dark:text-rose-300'
            : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800'
        "
        title="删除线"
        @click="editor?.chain().focus().toggleStrike().run()"
      >
        S
      </button>
      <button
        type="button"
        class="rounded px-2 py-1 font-mono text-xs transition"
        :class="
          editor.isActive('code')
            ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/25 dark:text-rose-300'
            : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800'
        "
        title="行内代码"
        @click="editor?.chain().focus().toggleCode().run()"
      >
        &lt;&gt;
      </button>

      <span class="mx-1 h-3.5 w-[1px] bg-slate-200 dark:bg-slate-700" />

      <!-- 块级结构 -->
      <button
        type="button"
        class="rounded px-2 py-1 text-xs transition"
        :class="
          editor.isActive('bulletList')
            ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/25 dark:text-rose-300'
            : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800'
        "
        title="无序列表"
        @click="editor?.chain().focus().toggleBulletList().run()"
      >
        • 列表
      </button>
      <button
        type="button"
        class="rounded px-2 py-1 text-xs transition"
        :class="
          editor.isActive('orderedList')
            ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/25 dark:text-rose-300'
            : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800'
        "
        title="有序列表"
        @click="editor?.chain().focus().toggleOrderedList().run()"
      >
        1. 列表
      </button>
      <button
        type="button"
        class="rounded px-2 py-1 text-xs transition"
        :class="
          editor.isActive('blockquote')
            ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/25 dark:text-rose-300'
            : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800'
        "
        title="引用块"
        @click="editor?.chain().focus().toggleBlockquote().run()"
      >
        &ldquo; 引用
      </button>
      <button
        type="button"
        class="rounded px-2 py-1 text-xs transition font-mono"
        :class="
          editor.isActive('codeBlock')
            ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/25 dark:text-rose-300'
            : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800'
        "
        title="代码块"
        @click="editor?.chain().focus().toggleCodeBlock().run()"
      >
        代码块
      </button>
      <button
        type="button"
        class="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800 transition"
        title="水平分割线"
        @click="editor?.chain().focus().setHorizontalRule().run()"
      >
        ―
      </button>

      <span class="mx-1 h-3.5 w-[1px] bg-slate-200 dark:bg-slate-700" />

      <!-- 链接与图片 -->
      <button
        type="button"
        class="rounded px-2 py-1 text-xs transition"
        :class="
          editor.isActive('link')
            ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/25 dark:text-rose-300'
            : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800'
        "
        title="插入链接"
        @click="handleSetLink"
      >
        🔗 链接
      </button>
      <button
        type="button"
        class="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800 transition"
        title="插入图片（支持拖拽与粘贴直接上传）"
        @click="emit('upload-image-request')"
      >
        🖼️ 图片
      </button>

      <span class="mx-1 h-3.5 w-[1px] bg-slate-200 dark:bg-slate-700" />

      <!-- 撤销与重做 -->
      <button
        type="button"
        class="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-200/70 disabled:opacity-40 disabled:hover:bg-transparent dark:text-slate-300 dark:hover:bg-slate-800 transition"
        title="撤销 (Ctrl/Cmd+Z)"
        :disabled="!editor.can().undo()"
        @click="editor?.chain().focus().undo().run()"
      >
        ↶
      </button>
      <button
        type="button"
        class="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-200/70 disabled:opacity-40 disabled:hover:bg-transparent dark:text-slate-300 dark:hover:bg-slate-800 transition"
        title="重做 (Ctrl/Cmd+Y)"
        :disabled="!editor.can().redo()"
        @click="editor?.chain().focus().redo().run()"
      >
        ↷
      </button>

      <!-- 清除格式 -->
      <button
        type="button"
        class="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-200/70 dark:text-slate-400 dark:hover:bg-slate-800 transition"
        title="清除所有文字样式"
        @click="editor?.chain().focus().unsetAllMarks().clearNodes().run()"
      >
        ✕ 清除
      </button>

      <!-- 全屏切换按钮 -->
      <div class="ml-auto flex items-center gap-2 pl-2">
        <span class="text-[11px] text-slate-400 select-none">
          {{ textCharCount }} 字符
        </span>
        <button
          type="button"
          data-testid="tiptap-toggle-fullscreen"
          class="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition"
          :class="
            isFullscreen
              ? 'bg-rose-100 text-rose-700 hover:bg-rose-200 dark:bg-rose-500/25 dark:text-rose-300'
              : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800'
          "
          :title="isFullscreen ? '退出全屏 (Esc)' : '全屏编辑 (Esc退出)'"
          @click="toggleFullscreen"
        >
          <svg
            v-if="isFullscreen"
            class="h-3.5 w-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M9 9L4 4m0 0h4m-4 0v4m11 5l5 5m0 0h-4m4 0v-4m-5-11l5-5m0 0h-4m4 0v4M9 15l-5 5m0 0h4m-4 0v-4"
            />
          </svg>
          <svg
            v-else
            class="h-3.5 w-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0-4l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
            />
          </svg>
          <span>{{ isFullscreen ? '退出全屏' : '全屏' }}</span>
        </button>
      </div>
    </div>

    <!-- Tiptap 编辑容器 -->
    <div
      class="candy-tiptap-scroll flex-1 min-h-0 overflow-y-auto"
      :class="isFullscreen ? 'p-4 sm:p-8' : ''"
    >
      <div :class="isFullscreen ? 'max-w-4xl mx-auto h-full' : 'h-full'">
        <editor-content :editor="editor" class="h-full" />
      </div>
    </div>

    <!-- 同步隐藏 textarea，便于无障碍辅助、表单回退及单元测试兼容 -->
    <textarea
      ref="fallbackTextareaRef"
      class="sr-only fixed -top-full -left-full h-0 w-0 opacity-0 pointer-events-none"
      :value="modelValue"
      tabindex="-1"
      aria-hidden="true"
      @input="handleFallbackInput"
    />
  </div>
</template>

<style>
/* Tiptap 与 ProseMirror 排版样式定制 */
.candy-tiptap-content {
  font-family: inherit;
  font-size: 0.95rem;
  line-height: 1.75;
}

.candy-tiptap-content p {
  margin: 0.5rem 0;
}

.candy-tiptap-content h1 {
  font-size: 1.65rem;
  font-weight: 700;
  line-height: 1.3;
  margin-top: 1.25rem;
  margin-bottom: 0.5rem;
}

.candy-tiptap-content h2 {
  font-size: 1.35rem;
  font-weight: 600;
  line-height: 1.35;
  margin-top: 1rem;
  margin-bottom: 0.4rem;
}

.candy-tiptap-content h3 {
  font-size: 1.15rem;
  font-weight: 600;
  line-height: 1.4;
  margin-top: 0.75rem;
  margin-bottom: 0.35rem;
}

.candy-tiptap-content ul {
  list-style-type: disc;
  padding-left: 1.5rem;
  margin: 0.5rem 0;
}

.candy-tiptap-content ol {
  list-style-type: decimal;
  padding-left: 1.5rem;
  margin: 0.5rem 0;
}

.candy-tiptap-content li {
  margin: 0.25rem 0;
}

.candy-tiptap-content blockquote {
  border-left: 3px solid #f43f5e;
  padding-left: 1rem;
  padding-top: 0.25rem;
  padding-bottom: 0.25rem;
  margin: 0.75rem 0;
  background-color: rgba(244, 63, 94, 0.05);
  font-style: italic;
  border-radius: 0 0.375rem 0.375rem 0;
}

.dark .candy-tiptap-content blockquote {
  border-left-color: #fb7185;
  background-color: rgba(244, 63, 94, 0.1);
}

/* 行内代码样式：排除 pre 内的代码，日间模式浅灰底 + 细边框，夜间模式暗色底 */
.candy-tiptap-content :not(pre) > code {
  background-color: #f1f5f9;
  color: #e11d48;
  padding: 0.15rem 0.35rem;
  border-radius: 0.25rem;
  font-size: 0.85em;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  border: 1px solid #e2e8f0;
}

.dark .candy-tiptap-content :not(pre) > code {
  background-color: #1e293b;
  color: #fda4af;
  border-color: #334155;
}

/* 多行代码块 (pre)：
   日间模式采用明亮清爽的浅灰底色 (#f8fafc) + 清晰深色文字 (#1e293b) + 细边框 (#e2e8f0)，解决日间模式黑底或文字反差异常问题；
   夜间模式保持深蓝黑底色 (#0f172a) + 亮浅文字 (#e2e8f0) + 深色边框 (#1e293b)
*/
.candy-tiptap-content pre {
  background-color: #f8fafc;
  color: #1e293b;
  border: 1px solid #e2e8f0;
  padding: 0.85rem 1.15rem;
  border-radius: 0.5rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.875rem;
  line-height: 1.65;
  overflow-x: auto;
  margin: 0.85rem 0;
}

.dark .candy-tiptap-content pre {
  background-color: #0f172a;
  color: #e2e8f0;
  border-color: #1e293b;
}

/* 代码块内部 code 必须纯粹继承 pre 样式，不得继承行内代码的红字与背景 */
.candy-tiptap-content pre code {
  background-color: transparent !important;
  color: inherit !important;
  border: none !important;
  padding: 0 !important;
  font-size: inherit !important;
  line-height: inherit !important;
}

.candy-tiptap-content hr {
  border: 0;
  border-top: 1px solid #e2e8f0;
  margin: 1.25rem 0;
}

.dark .candy-tiptap-content hr {
  border-top-color: #334155;
}

.candy-tiptap-content a {
  color: #e11d48;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.dark .candy-tiptap-content a {
  color: #fb7185;
}

.candy-tiptap-content img.candy-tiptap-image {
  max-width: 100%;
  height: auto;
  border-radius: 0.5rem;
  margin: 0.75rem 0;
  border: 1px solid #e2e8f0;
}

.dark .candy-tiptap-content img.candy-tiptap-image {
  border-color: #334155;
}

/* 占位提示文字样式 */
.candy-tiptap-content p.is-editor-empty:first-child::before {
  content: attr(data-placeholder);
  float: left;
  color: #94a3b8;
  pointer-events: none;
  height: 0;
}

.dark .candy-tiptap-content p.is-editor-empty:first-child::before {
  color: #64748b;
}
</style>
