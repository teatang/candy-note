<script setup lang="ts">
import {
  ArrowDown,
  Document,
  Key,
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
import { useLocaleStore } from '@/stores/locale'
import { useNoteStore } from '@/stores/note'
import { formatDateTime } from '@/utils/date'

/**
 * 顶部极简导航栏组件
 * 包含品牌标识、主题切换、中英文切换、管理后台入口以及账号/长时间自动登录设置弹窗
 */
const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const noteStore = useNoteStore()
const localeStore = useLocaleStore()

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
  await router.push('/login')
}
</script>

<template>
  <header
    class="flex h-13 shrink-0 items-center justify-between border-b border-slate-200/80 bg-white/90 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90"
  >
    <div class="flex items-center gap-3">
      <router-link to="/" class="no-underline">
        <AppLogo />
      </router-link>
    </div>

    <div class="flex items-center gap-2">
      <!-- 管理员可在笔记工作区与管理后台之间快速切换 -->
      <el-button
        v-if="authStore.isAdmin && route.name !== 'admin'"
        size="small"
        plain
        type="primary"
        class="!rounded-lg"
        @click="router.push('/admin')"
      >
        <el-icon class="mr-1"><Setting /></el-icon>
        <span>{{ t('auth.goAdmin') }}</span>
      </el-button>
      <el-button
        v-else-if="route.name === 'admin'"
        size="small"
        plain
        class="!rounded-lg"
        @click="router.push('/')"
      >
        <el-icon class="mr-1"><Document /></el-icon>
        <span>{{ t('auth.goWorkspace') }}</span>
      </el-button>

      <ThemeToggle />
      <LocaleToggle />

      <!-- 用户菜单 -->
      <el-dropdown v-if="authStore.user" trigger="click">
        <button
          type="button"
          class="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:border-rose-300 hover:bg-rose-50/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-rose-500/50"
        >
          <el-icon class="text-rose-500"><UserIcon /></el-icon>
          <span class="max-w-28 truncate">{{ authStore.user.username }}</span>
          <el-icon class="text-slate-400"><ArrowDown /></el-icon>
        </button>

        <template #dropdown>
          <el-dropdown-menu>
            <div class="px-3 py-2 text-xs text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800">
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
      width="440px"
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
