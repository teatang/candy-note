<script setup lang="ts">
import { Key, Lock, Refresh, User as UserIcon } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { authApi } from '@/api/auth'
import { resolveApiErrorMessage } from '@/api/client'
import AppLogo from '@/components/common/AppLogo.vue'
import LocaleToggle from '@/components/common/LocaleToggle.vue'
import ThemeToggle from '@/components/common/ThemeToggle.vue'
import { useAuthStore } from '@/stores/auth'

/**
 * 用户登录页视图
 * - 用户名支持输入昵称或注册邮箱
 * - 强制要求填写服务端生成的 SVG 图片验证码
 * - 支持勾选 30 天长时间自动登录，登录后也可随时在工作区切换开启
 * - 明确提示不支持前台注册，需联系管理员在后台添加账号
 */
const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

const captchaId = ref('')
const captchaImage = ref('')
const loadingCaptcha = ref(false)
const submitting = ref(false)

const form = reactive({
  identifier: '',
  password: '',
  captchaCode: '',
  rememberMe: false
})

async function refreshCaptcha() {
  loadingCaptcha.value = true
  try {
    const res = await authApi.getCaptcha()
    captchaId.value = res.captchaId
    captchaImage.value = res.image
    form.captchaCode = ''
  } catch (err) {
    ElMessage.error(resolveApiErrorMessage(err))
  } finally {
    loadingCaptcha.value = false
  }
}

async function handleLogin() {
  if (!form.identifier.trim() || !form.password || !form.captchaCode.trim()) {
    ElMessage.warning(t('errors.VALIDATION_ERROR'))
    return
  }

  submitting.value = true
  try {
    await authStore.login({
      identifier: form.identifier.trim(),
      password: form.password,
      captchaId: captchaId.value,
      captchaCode: form.captchaCode.trim(),
      rememberMe: form.rememberMe
    })

    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
    await router.replace(redirect)
  } catch (err) {
    ElMessage.error(resolveApiErrorMessage(err))
    // 每次校验失败立即刷新一次性验证码
    await refreshCaptcha()
  } finally {
    submitting.value = false
  }
}

onMounted(() => {
  refreshCaptcha()
})
</script>

<template>
  <div
    class="relative flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-rose-50/70 via-white to-amber-50/60 px-4 pt-16 pb-10 sm:py-10 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900"
  >
    <!-- 右上角主题与语言切换控件 -->
    <div class="absolute top-3 right-3 flex items-center gap-2 sm:top-4 sm:right-4">
      <ThemeToggle />
      <LocaleToggle />
    </div>

    <div
      class="w-full max-w-md rounded-2xl border border-slate-200/80 bg-white/95 p-5 shadow-xl shadow-rose-500/5 backdrop-blur sm:rounded-3xl sm:p-8 dark:border-slate-800 dark:bg-slate-900/95"
    >
      <div class="mb-6 flex flex-col items-center text-center">
        <AppLogo />
        <h1 class="mt-4 text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          {{ t('auth.loginTitle') }}
        </h1>
        <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {{ t('auth.loginSubtitle') }}
        </p>
      </div>

      <el-form label-position="top" class="space-y-1" @submit.prevent="handleLogin">
        <el-form-item :label="t('auth.identifierLabel')">
          <el-input
            v-model="form.identifier"
            size="large"
            :prefix-icon="UserIcon"
            :placeholder="t('auth.identifierPlaceholder')"
            autocomplete="username"
          />
        </el-form-item>

        <el-form-item :label="t('auth.passwordLabel')">
          <el-input
            v-model="form.password"
            size="large"
            type="password"
            show-password
            :prefix-icon="Lock"
            :placeholder="t('auth.passwordPlaceholder')"
            autocomplete="current-password"
          />
        </el-form-item>

        <el-form-item :label="t('auth.captchaLabel')">
          <div class="flex w-full items-center gap-2.5">
            <el-input
              v-model="form.captchaCode"
              size="large"
              maxlength="6"
              :prefix-icon="Key"
              :placeholder="t('auth.captchaPlaceholder')"
              class="flex-1"
            />
            <button
              type="button"
              class="group relative flex h-10 w-28 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 transition hover:border-rose-300 sm:w-34 dark:border-slate-700 dark:bg-slate-800"
              :title="t('auth.captchaRefreshTip')"
              @click="refreshCaptcha"
            >
              <img
                v-if="captchaImage"
                :src="captchaImage"
                alt="captcha"
                class="h-full w-full object-cover"
              />
              <el-icon v-else class="animate-spin text-slate-400"><Refresh /></el-icon>
            </button>
          </div>
        </el-form-item>

        <div class="flex items-center justify-between pt-1 pb-3">
          <el-checkbox v-model="form.rememberMe">
            <span class="text-xs text-slate-600 dark:text-slate-300">
              {{ t('auth.rememberMe') }}
            </span>
          </el-checkbox>
        </div>

        <el-button
          type="primary"
          size="large"
          native-type="submit"
          :loading="submitting"
          class="!w-full !rounded-xl !font-medium"
        >
          {{ submitting ? t('auth.loggingIn') : t('auth.loginButton') }}
        </el-button>
      </el-form>

      <div
        class="mt-6 rounded-2xl border border-amber-200/70 bg-amber-50/70 px-3.5 py-2.5 text-center text-xs leading-relaxed text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300"
      >
        {{ t('auth.noPublicRegisterTip') }}
      </div>
    </div>
  </div>
</template>
