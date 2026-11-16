<script setup lang="ts">
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3'
import { ElMessageBox, ElMessage } from 'element-plus'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps(nodeViewProps)

const imageBoxRef = ref<HTMLElement | null>(null)
const imageRef = ref<HTMLImageElement | null>(null)

const isHovered = ref(false)
const isSelected = ref(false)
const isResizing = ref(false)
const resizingWidth = ref<number | null>(null)
const resizingBadge = ref('')

const isEditable = computed(() => props.editor?.isEditable ?? true)

const shouldShowControls = computed(() => {
  return (
    isEditable.value &&
    (isHovered.value || isSelected.value || Boolean(props.selected) || isResizing.value)
  )
})

const sizePresets = [
  { label: '25%', value: '25%' },
  { label: '50%', value: '50%' },
  { label: '75%', value: '75%' },
  { label: '100%', value: '100%' }
]

const currentWidth = computed<string>(() => {
  const w = props.node?.attrs?.width
  if (typeof w === 'number') return `${w}px`
  if (typeof w === 'string' && w.trim()) return w.trim()
  return '100%'
})

const alignment = computed<'left' | 'center' | 'right'>(() => {
  const align = props.node?.attrs?.alignment
  if (align === 'left' || align === 'right' || align === 'center') return align
  return 'center'
})

const containerAlignmentClass = computed(() => {
  if (alignment.value === 'left') return 'flex justify-start'
  if (alignment.value === 'right') return 'flex justify-end'
  return 'flex justify-center'
})

const displayWidth = computed(() => {
  if (isResizing.value && resizingWidth.value !== null) {
    return `${resizingWidth.value}px`
  }
  return currentWidth.value
})

function handleSetPreset(size: string) {
  props.updateAttributes({ width: size })
}

function handleSetAlignment(align: 'left' | 'center' | 'right') {
  props.updateAttributes({ alignment: align })
}

async function handleCustomSizePrompt() {
  try {
    const { value } = await ElMessageBox.prompt(
      '请输入图片显示宽度（如 300px 或 60%）',
      '自定义图片大小',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        inputValue: currentWidth.value,
        inputPattern: /^(\d+)(px|%)?$/,
        inputErrorMessage: '请输入合法的尺寸数值，例如 350px 或 50%'
      }
    )
    if (!value) return
    const formatted = /^\d+$/.test(value.trim()) ? `${value.trim()}px` : value.trim()
    props.updateAttributes({ width: formatted })
  } catch {
    // 用户取消输入
  }
}

function handleClickImage(e: MouseEvent) {
  e.stopPropagation()
  isSelected.value = !isSelected.value
}

// ---------------- 鼠标/触控拖拽缩放 ----------------
let startX = 0
let startWidthPx = 0
let containerWidthPx = 800
let activeDirection: 'left' | 'right' = 'right'

function startResize(e: MouseEvent, direction: 'left' | 'right') {
  if (!isEditable.value) return
  e.preventDefault()
  e.stopPropagation()

  activeDirection = direction
  startX = e.clientX

  const boxEl = imageBoxRef.value
  startWidthPx = boxEl?.getBoundingClientRect().width || 300

  const containerEl =
    boxEl?.closest('.candy-tiptap-content') ||
    boxEl?.closest('.candy-tiptap-scroll') ||
    boxEl?.parentElement
  containerWidthPx = containerEl?.getBoundingClientRect().width || window.innerWidth

  isResizing.value = true
  resizingWidth.value = startWidthPx
  const percent = Math.min(100, Math.max(10, Math.round((startWidthPx / containerWidthPx) * 100)))
  resizingBadge.value = `${Math.round(startWidthPx)}px · ${percent}%`

  document.body.style.cursor = 'ew-resize'
  document.body.style.userSelect = 'none'

  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
}

function onMouseMove(e: MouseEvent) {
  if (!isResizing.value) return
  const currentX = e.clientX
  const deltaX = currentX - startX

  let newWidth = startWidthPx
  if (alignment.value === 'center') {
    // 居中模式下，向外拖动单侧 deltaX，对称缩放 2 * deltaX
    if (activeDirection === 'right') {
      newWidth = startWidthPx + deltaX * 2
    } else {
      newWidth = startWidthPx - deltaX * 2
    }
  } else if (alignment.value === 'left') {
    if (activeDirection === 'right') {
      newWidth = startWidthPx + deltaX
    } else {
      newWidth = startWidthPx - deltaX
    }
  } else if (alignment.value === 'right') {
    if (activeDirection === 'left') {
      newWidth = startWidthPx - deltaX
    } else {
      newWidth = startWidthPx + deltaX
    }
  }

  const clampedWidth = Math.min(Math.max(newWidth, 80), containerWidthPx)
  resizingWidth.value = Math.round(clampedWidth)

  const percent = Math.min(100, Math.max(10, Math.round((clampedWidth / containerWidthPx) * 100)))
  resizingBadge.value = `${Math.round(clampedWidth)}px · ${percent}%`
}

function onMouseUp() {
  if (!isResizing.value) return
  isResizing.value = false

  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)

  document.body.style.cursor = ''
  document.body.style.userSelect = ''

  if (resizingWidth.value !== null) {
    const percent = Math.min(
      100,
      Math.max(10, Math.round((resizingWidth.value / containerWidthPx) * 100))
    )
    const finalWidth = percent >= 98 ? '100%' : `${percent}%`
    props.updateAttributes({ width: finalWidth })
  }
  resizingWidth.value = null
}

function startResizeTouch(e: TouchEvent, direction: 'left' | 'right') {
  if (!isEditable.value || !e.touches[0]) return
  e.preventDefault()
  e.stopPropagation()

  activeDirection = direction
  startX = e.touches[0].clientX

  const boxEl = imageBoxRef.value
  startWidthPx = boxEl?.getBoundingClientRect().width || 300

  const containerEl =
    boxEl?.closest('.candy-tiptap-content') ||
    boxEl?.closest('.candy-tiptap-scroll') ||
    boxEl?.parentElement
  containerWidthPx = containerEl?.getBoundingClientRect().width || window.innerWidth

  isResizing.value = true
  resizingWidth.value = startWidthPx

  window.addEventListener('touchmove', onTouchMove, { passive: false })
  window.addEventListener('touchend', onTouchEnd)
}

function onTouchMove(e: TouchEvent) {
  if (!isResizing.value || !e.touches[0]) return
  e.preventDefault()
  const currentX = e.touches[0].clientX
  const deltaX = currentX - startX

  let newWidth = startWidthPx
  if (alignment.value === 'center') {
    if (activeDirection === 'right') {
      newWidth = startWidthPx + deltaX * 2
    } else {
      newWidth = startWidthPx - deltaX * 2
    }
  } else if (alignment.value === 'left') {
    newWidth = activeDirection === 'right' ? startWidthPx + deltaX : startWidthPx - deltaX
  } else if (alignment.value === 'right') {
    newWidth = activeDirection === 'left' ? startWidthPx - deltaX : startWidthPx + deltaX
  }

  const clampedWidth = Math.min(Math.max(newWidth, 80), containerWidthPx)
  resizingWidth.value = Math.round(clampedWidth)

  const percent = Math.min(100, Math.max(10, Math.round((clampedWidth / containerWidthPx) * 100)))
  resizingBadge.value = `${Math.round(clampedWidth)}px · ${percent}%`
}

function onTouchEnd() {
  if (!isResizing.value) return
  isResizing.value = false

  window.removeEventListener('touchmove', onTouchMove)
  window.removeEventListener('touchend', onTouchEnd)

  if (resizingWidth.value !== null) {
    const percent = Math.min(
      100,
      Math.max(10, Math.round((resizingWidth.value / containerWidthPx) * 100))
    )
    const finalWidth = percent >= 98 ? '100%' : `${percent}%`
    props.updateAttributes({ width: finalWidth })
  }
  resizingWidth.value = null
}

function handleDocumentClick(e: MouseEvent) {
  if (imageBoxRef.value && !imageBoxRef.value.contains(e.target as Node)) {
    isSelected.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', handleDocumentClick)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleDocumentClick)
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
  window.removeEventListener('touchmove', onTouchMove)
  window.removeEventListener('touchend', onTouchEnd)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
})
</script>

<template>
  <node-view-wrapper
    as="div"
    class="candy-resizable-image-container relative my-3 transition-all"
    :class="containerAlignmentClass"
  >
    <!-- 图片外层卡片与定位框 -->
    <div
      ref="imageBoxRef"
      data-testid="candy-resizable-image-box"
      class="candy-image-box group relative inline-block max-w-full"
      :style="{ width: displayWidth }"
      @mouseenter="isHovered = true"
      @mouseleave="isHovered = false"
    >
      <!-- 浮动操作栏：尺寸预设、对齐方式、自定义尺寸、删除按钮 -->
      <div
        v-if="shouldShowControls"
        data-testid="candy-image-toolbar"
        class="candy-image-toolbar absolute -top-11 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-slate-200 bg-white/95 px-2 py-1 shadow-md backdrop-blur transition-all dark:border-slate-700 dark:bg-slate-900/95"
        @mousedown.stop
      >
        <!-- 尺寸预设快捷按钮 -->
        <span class="mr-1 text-[11px] font-medium text-slate-400 select-none">大小:</span>
        <button
          v-for="size in sizePresets"
          :key="size.value"
          type="button"
          :data-testid="`size-preset-${size.value}`"
          class="rounded px-1.5 py-0.5 text-[11px] font-medium transition"
          :class="
            currentWidth === size.value
              ? 'bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-300'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
          "
          :title="`设置为 ${size.label}`"
          @click.stop="handleSetPreset(size.value)"
        >
          {{ size.label }}
        </button>

        <button
          type="button"
          data-testid="size-custom-btn"
          class="rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 transition"
          title="自定义输入具体宽度数值"
          @click.stop="handleCustomSizePrompt"
        >
          自定义
        </button>

        <span class="mx-1 h-3 w-[1px] bg-slate-200 dark:bg-slate-700" />

        <!-- 对齐方式切换 -->
        <button
          type="button"
          data-testid="align-left-btn"
          class="rounded p-1 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 transition"
          :class="
            alignment === 'left'
              ? 'bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-300'
              : ''
          "
          title="居左对齐"
          @click.stop="handleSetAlignment('left')"
        >
          <svg
            class="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="15" y2="12" />
            <line x1="3" y1="18" x2="18" y2="18" />
          </svg>
        </button>
        <button
          type="button"
          data-testid="align-center-btn"
          class="rounded p-1 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 transition"
          :class="
            alignment === 'center'
              ? 'bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-300'
              : ''
          "
          title="居中对齐"
          @click.stop="handleSetAlignment('center')"
        >
          <svg
            class="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="6" y1="12" x2="18" y2="12" />
            <line x1="4" y1="18" x2="20" y2="18" />
          </svg>
        </button>
        <button
          type="button"
          data-testid="align-right-btn"
          class="rounded p-1 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 transition"
          :class="
            alignment === 'right'
              ? 'bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-300'
              : ''
          "
          title="居右对齐"
          @click.stop="handleSetAlignment('right')"
        >
          <svg
            class="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="9" y1="12" x2="21" y2="12" />
            <line x1="6" y1="18" x2="21" y2="18" />
          </svg>
        </button>

        <span class="mx-1 h-3 w-[1px] bg-slate-200 dark:bg-slate-700" />

        <!-- 移除图片 -->
        <button
          type="button"
          data-testid="delete-image-btn"
          class="rounded p-1 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition"
          title="删除图片"
          @click.stop="props.deleteNode()"
        >
          <svg
            class="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <polyline points="3 6 5 6 21 6" />
            <path
              d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
            />
          </svg>
        </button>
      </div>

      <!-- 图片实体 -->
      <img
        ref="imageRef"
        :src="props.node?.attrs?.src"
        :alt="props.node?.attrs?.alt || ''"
        :title="props.node?.attrs?.title || ''"
        data-testid="candy-tiptap-image-el"
        class="candy-tiptap-image block w-full rounded-lg border border-slate-200 object-contain transition-shadow dark:border-slate-800"
        :class="[
          isSelected || isResizing
            ? 'ring-2 ring-rose-500 ring-offset-2 dark:ring-offset-slate-900'
            : '',
          isResizing ? 'select-none pointer-events-none' : 'cursor-pointer'
        ]"
        @click="handleClickImage"
      />

      <!-- 拖拽缩放手柄（右侧边栏手柄与右下角圆点手柄，以及左侧与左下角手柄） -->
      <template v-if="shouldShowControls">
        <!-- 右侧边栏手柄 -->
        <div
          data-testid="resize-handle-right"
          class="candy-resize-handle candy-resize-handle-right absolute top-1/2 -right-1.5 h-10 w-2 -translate-y-1/2 cursor-ew-resize rounded-full bg-rose-500/80 hover:bg-rose-600 shadow-sm transition hover:scale-110 active:scale-125"
          title="拖拽改变图片大小"
          @mousedown="startResize($event, 'right')"
          @touchstart="startResizeTouch($event, 'right')"
        />

        <!-- 右下角手柄 -->
        <div
          data-testid="resize-handle-se"
          class="candy-resize-handle candy-resize-handle-se absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 cursor-nwse-resize rounded-full border-2 border-white bg-rose-500 shadow-md hover:scale-125 active:scale-125 transition dark:border-slate-900"
          title="拖拽改变图片大小"
          @mousedown="startResize($event, 'right')"
          @touchstart="startResizeTouch($event, 'right')"
        />

        <!-- 左侧边栏手柄 -->
        <div
          data-testid="resize-handle-left"
          class="candy-resize-handle candy-resize-handle-left absolute top-1/2 -left-1.5 h-10 w-2 -translate-y-1/2 cursor-ew-resize rounded-full bg-rose-500/80 hover:bg-rose-600 shadow-sm transition hover:scale-110 active:scale-125"
          title="拖拽改变图片大小"
          @mousedown="startResize($event, 'left')"
          @touchstart="startResizeTouch($event, 'left')"
        />

        <!-- 左下角手柄 -->
        <div
          data-testid="resize-handle-sw"
          class="candy-resize-handle candy-resize-handle-sw absolute -bottom-1.5 -left-1.5 h-3.5 w-3.5 cursor-nesw-resize rounded-full border-2 border-white bg-rose-500 shadow-md hover:scale-125 active:scale-125 transition dark:border-slate-900"
          title="拖拽改变图片大小"
          @mousedown="startResize($event, 'left')"
          @touchstart="startResizeTouch($event, 'left')"
        />
      </template>

      <!-- 拖拽缩放时的尺寸指示器 Badge -->
      <div
        v-if="isResizing"
        data-testid="resize-indicator-badge"
        class="absolute bottom-3 left-1/2 z-30 -translate-x-1/2 rounded bg-slate-900/90 px-2 py-0.5 text-[11px] font-mono font-medium text-white shadow pointer-events-none select-none backdrop-blur-sm"
      >
        {{ resizingBadge }}
      </div>
    </div>
  </node-view-wrapper>
</template>

<style scoped>
.candy-resizable-image-container {
  display: flex;
  width: 100%;
}

.candy-image-box {
  transition: width 0.15s ease-out;
}
</style>
