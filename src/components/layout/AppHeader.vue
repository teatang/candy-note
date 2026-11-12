<script setup lang="ts">
import {
  ArrowDown,
  Document,
  Expand,
  Files,
  Fold,
  Key,
  Menu,
  Setting,
  SwitchButton,
  User as UserIcon
} from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { resolveApiErrorMessage } from '@/api/client'
import AppLogo from '@/components/common/AppLogo.vue'
import LocaleToggle from '@/components/common/LocaleToggle.vue'
import ThemeToggle from '@/components/common/ThemeToggle.vue'
import { useAuthStore } from '@/stores/auth'
import { useLayoutStore } from '@/stores/layout'
import { useLocaleStore } from '@/stores/locale'
import { useNoteStore } from '@/stores/note'
import { formatDateTime } from '@/utils/date'

/**
 * 顶部极简导航栏组件
 * - 移动端提供文件夹抽屉入口
 * - 桌面端工作区提供文件夹栏与笔记列表栏一键折叠/展开控制
 * - 包含主题切换、中英文切换、管理后台入口以及账号/长时间自动登录设置弹窗
 */
const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const noteStore = useNoteStore()
const localeStore = useLocaleStore()
const layoutStore = useLayoutStore()

const accountDialogOpen = ref(false)
const updatingSession = ref(false)
const changingPwd = ref(false)

const pwdForm = reactive({
  currentPassword: '',
  newPassword: '',
  confirmPassword: ''
})

async function handleToggleAutoLogin(enable: boolean) {
  updatingSession.value = true
  try {
    await authStore.extendSession(enable)
    ElMessage.success(enable ? t('auth.autoLoginEnabledMsg') : t('auth.autoLoginDisabledMsg'))
  } catch (err) {
    ElMessage.error(resolveApiErrorMessage(err))
  } finally {
    updatingSession.value = false
  }
}

async function handleChangePassword() {
  if (pwdForm.newPassword !== pwdForm.confirmPassword) {
    ElMessage.warning(t('auth.passwordMismatch'))
    return
  }
  changingPwd.value = true
  try {
    await authStore.changePassword(pwdForm.currentPassword, pwdForm.newPassword)
    ElMessage.success(t('auth.passwordChanged'))
    pwdForm.currentPassword = ''
    pwdForm.newPassword = ''
    pwdForm.confirmPassword = ''
  } catch (err) {
    ElMessage.error(resolveApiErrorMessage(err))
  } finally {
    changingPwd.value = false
  }
}

async function handleLogout() {
  await authStore.logout()
  noteStore.reset()
  layoutStore.resetTransientLayout()
  await router.push('/login')
}
</script>

<template>
  <header
    class="flex h-13 shrink-0 items-center justify-between gap-2 border-b border-slate-200/80 bg-white/90 px-2.5 backdrop-blur sm:px-4 dark:border-slate-800 dark:bg-slate-900/90"
  >
    <div class="flex min-w-0 items-center gap-2 sm:gap-3">
      <!-- 移动端文件夹抽屉按钮 -->
      <button
        v-if="route.name === 'workspace'"
        type="button"
        data-testid="mobile-folders-btn"
        class="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:border-rose-300 hover:text-rose-500 md:hidden dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
        :aria-label="t('layout.openFolders')"
        @click="layoutStore.setMobileFoldersOpen(!layoutStore.mobileFoldersOpen)"
      >
        <el-icon><Menu /></el-icon>
      </button>

      <!-- 桌面端工作区侧边栏折叠控制按钮 -->
      <div v-if="route.name === 'workspace'" class="hidden items-center gap-1 md:flex">
        <el-tooltip
          :content="
            layoutStore.folderSidebarCollapsed
              ? t('layout.expandFolders')
              : t('layout.collapseFolders')
          "
          placement="bottom"
        >
          <button
            type="button"
            data-testid="toggle-folder-sidebar"
            class="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 transition dark:border-slate-700"
            :class="
              layoutStore.folderSidebarCollapsed
                ? 'bg-rose-50 text-rose-600 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/40'
                : 'bg-white text-slate-600 hover:border-rose-300 hover:text-rose-500 dark:bg-slate-800 dark:text-slate-300'
            "
            :aria-label="
              layoutStore.folderSidebarCollapsed
                ? t('layout.expandFolders')
                : t('layout.collapseFolders')
            "
            @click="layoutStore.toggleFolderSidebar()"
          >
            <el-icon>
              <Expand v-if="layoutStore.folderSidebarCollapsed" />
              <Fold v-else />
            </el-icon>
          </button>
        </el-tooltip>

        <el-tooltip
          :content="
            layoutStore.noteListCollapsed ? t('layout.expandNotes') : t('layout.collapseNotes')
          "
          placement="bottom"
        >
          <button
            type="button"
            data-testid="toggle-note-list"
            class="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 transition dark:border-slate-700"
            :class="
              layoutStore.noteListCollapsed
                ? 'bg-rose-50 text-rose-600 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/40'
                : 'bg-white text-slate-600 hover:border-rose-300 hover:text-rose-500 dark:bg-slate-800 dark:text-slate-300'
            "
            :aria-label="
              layoutStore.noteListCollapsed ? t('layout.expandNotes') : t('layout.collapseNotes')
            "
            @click="layoutStore.toggleNoteList()"
          >
            <el-icon><Files /></el-icon>
          </button>
        </el-tooltip>
      </div>

      <router-link to="/" class="no-underline">
        <AppLogo />
      </router-link>
    </div>

    <div class="flex shrink-0 items-center gap-1.5 sm:gap-2">
      <!-- 管理员可在笔记工作区与管理后台之间快速切换 -->
      <el-button
        v-if="authStore.isAdmin && route.name !== 'admin'"
        size="small"
        plain
        type="primary"
        class="!rounded-lg !px-2 sm:!px-3"
        @click="router.push('/admin')"
      >
        <el-icon class="sm:mr-1"><Setting /></el-icon>
        <span class="hidden sm:inline">{{ t('auth.goAdmin') }}</span>
      </el-button>
      <el-button
        v-else-if="route.name === 'admin'"
        size="small"
        plain
        class="!rounded-lg !px-2 sm:!px-3"
        @click="router.push('/')"
      >
        <el-icon class="sm:mr-1"><Document /></el-icon>
        <span class="hidden sm:inline">{{ t('auth.goWorkspace') }}</span>
      </el-button>

      <ThemeToggle />
      <LocaleToggle />

      <!-- 用户菜单 -->
      <el-dropdown v-if="authStore.user" trigger="click">
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700 transition hover:border-rose-300 hover:bg-rose-50/40 sm:gap-2 sm:px-2.5 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-rose-500/50"
        >
          <el-icon class="text-rose-500"><UserIcon /></el-icon>
          <span class="hidden max-w-24 truncate sm:inline">{{ authStore.user.username }}</span>
          <el-icon class="text-slate-400"><ArrowDown /></el-icon>
        </button>

        <template #dropdown>
          <el-dropdown-menu>
            <div class="border-b border-slate-100 px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
              <div class="font-medium text-slate-800 dark:text-slate-200">
                {{ authStore.user.username }}
              </div>
              <div class="truncate">{{ authStore.user.email }}</div>
              <div class="mt-1">
                <el-tag
                  size="small"
                  :type="authStore.isAutoLoginEnabled ? 'success' : 'info'"
                  effect="light"
                >
                  {{
                    authStore.isAutoLoginEnabled
                      ? t('auth.autoLoginActiveTag')
                      : t('auth.standardSessionTag')
                  }}
                </el-tag>
              </div>
            </div>

            <el-dropdown-item @click="accountDialogOpen = true">
              <el-icon><Key /></el-icon>
              <span>{{ t('auth.accountSettings') }}</span>
            </el-dropdown-item>
            <el-dropdown-item divided @click="handleLogout">
              <el-icon><SwitchButton /></el-icon>
              <span class="text-rose-500">{{ t('auth.logout') }}</span>
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <!-- 账号设置与长时间自动登录管理弹窗 -->
    <el-dialog
      v-model="accountDialogOpen"
      :title="t('auth.accountSettings')"
      width="min(440px, 92vw)"
      append-to-body
    >
      <div class="space-y-5">
        <div
          class="rounded-xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-700 dark:bg-slate-800/60"
        >
          <div class="flex items-center justify-between gap-2">
            <div>
              <div class="text-sm font-medium text-slate-800 dark:text-slate-100">
                {{ t('auth.rememberMe') }}
              </div>
              <div
                v-if="authStore.session"
                class="mt-1 text-xs text-slate-500 dark:text-slate-400"
              >
                {{
                  t('auth.sessionExpiresAt', {
                    time: formatDateTime(authStore.session.expiresAt, localeStore.locale)
                  })
                }}
              </div>
            </div>
            <el-switch
              :model-value="authStore.isAutoLoginEnabled"
              :loading="updatingSession"
              @change="(val: string | number | boolean) => handleToggleAutoLogin(Boolean(val))"
            />
          </div>
        </div>

        <el-divider content-position="left">{{ t('auth.changePasswordTitle') }}</el-divider>

        <el-form label-position="top" @submit.prevent="handleChangePassword">
          <el-form-item :label="t('auth.currentPassword')">
            <el-input
              v-model="pwdForm.currentPassword"
              type="password"
              show-password
              autocomplete="current-password"
            />
          </el-form-item>
          <el-form-item :label="t('auth.newPassword')">
            <el-input
              v-model="pwdForm.newPassword"
              type="password"
              show-password
              autocomplete="new-password"
            />
          </el-form-item>
          <el-form-item :label="t('auth.confirmNewPassword')">
            <el-input
              v-model="pwdForm.confirmPassword"
              type="password"
              show-password
              autocomplete="new-password"
            />
          </el-form-item>
          <div class="flex justify-end gap-2">
            <el-button @click="accountDialogOpen = false">{{ t('common.close') }}</el-button>
            <el-button type="primary" :loading="changingPwd" native-type="submit">
              {{ t('common.save') }}
            </el-button>
          </div>
        </el-form>
      </div>
    </el-dialog>
  </header>
</template>
