<script setup lang="ts">
import { Close, Lock } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { resolveApiErrorMessage } from '@/api/client'
import AppHeader from '@/components/layout/AppHeader.vue'
import FolderSidebar from '@/components/notes/FolderSidebar.vue'
import NoteEditor from '@/components/notes/NoteEditor.vue'
import NoteList from '@/components/notes/NoteList.vue'
import { useAuthStore } from '@/stores/auth'
import { useLayoutStore } from '@/stores/layout'
import { useNoteStore } from '@/stores/note'

/**
 * 糖果笔记主工作区视图
 * - 桌面端：三栏极简布局（可独立折叠文件夹栏与笔记列表栏）
 * - 移动端：抽屉式文件夹 + 列表/编辑器自适应单栏切换
 * - 登录成功后若未开启长时间自动登录，顶部提供一键开启 30 天免登录横幅
 */
const { t } = useI18n()
const authStore = useAuthStore()
const noteStore = useNoteStore()
const layoutStore = useLayoutStore()
const enablingAutoLogin = ref(false)

async function handleEnableAutoLogin() {
  enablingAutoLogin.value = true
  try {
    await authStore.extendSession(true)
    ElMessage.success(t('auth.autoLoginEnabledMsg'))
  } catch (err) {
    ElMessage.error(resolveApiErrorMessage(err))
  } finally {
    enablingAutoLogin.value = false
  }
}

onMounted(async () => {
  try {
    await noteStore.loadWorkspace()
  } catch (err) {
    ElMessage.error(resolveApiErrorMessage(err))
  }
})

onBeforeUnmount(() => {
  layoutStore.resetTransientLayout()
})
</script>

<template>
  <div class="flex h-dvh flex-col overflow-hidden bg-slate-50 dark:bg-slate-950">
    <AppHeader />

    <!-- 登录成功后可选择开启 30 天长时间自动登录提示条 -->
    <div
      v-if="authStore.showAutoLoginBanner && !authStore.isAutoLoginEnabled"
      class="flex flex-wrap items-center justify-between gap-2 border-b border-rose-200/70 bg-rose-50/90 px-3 py-2 text-xs sm:px-4 dark:border-rose-500/20 dark:bg-rose-500/10"
    >
      <div class="flex items-center gap-2 text-rose-700 dark:text-rose-200">
        <el-icon><Lock /></el-icon>
        <span class="font-medium">{{ t('auth.autoLoginBannerTitle') }}</span>
        <span class="hidden text-rose-600/80 sm:inline dark:text-rose-300/80">
          {{ t('auth.autoLoginBannerDesc') }}
        </span>
      </div>
      <div class="flex items-center gap-2">
        <el-button
          size="small"
          type="primary"
          :loading="enablingAutoLogin"
          @click="handleEnableAutoLogin"
        >
          {{ t('auth.enableAutoLogin') }}
        </el-button>
        <button
          type="button"
          class="flex h-6 w-6 items-center justify-center rounded-md text-rose-500 hover:bg-rose-100 dark:hover:bg-rose-500/20"
          @click="authStore.dismissAutoLoginBanner()"
        >
          <el-icon><Close /></el-icon>
        </button>
      </div>
    </div>

    <!-- 响应式云笔记工作区主体 -->
    <div class="relative flex min-h-0 flex-1 overflow-hidden">
      <FolderSidebar />
      <NoteList />
      <NoteEditor />
    </div>
  </div>
</template>
