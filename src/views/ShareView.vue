<script setup lang="ts">
import {
  Calendar,
  Document,
  Key,
  Lock,
  Timer,
  Unlock,
  User as UserIcon,
  View,
  WarningFilled
} from '@element-plus/icons-vue'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { publicShareApi } from '@/api/notes'
import AppLogo from '@/components/common/AppLogo.vue'
import LocaleToggle from '@/components/common/LocaleToggle.vue'
import ThemeToggle from '@/components/common/ThemeToggle.vue'
import { useAuthStore } from '@/stores/auth'
import { useLocaleStore } from '@/stores/locale'
import type { PublicSharedNote } from '@/types'
import { formatDateTime } from '@/utils/date'
import { renderMarkdownSafe, sanitizeHtml } from '@/utils/markdown'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const localeStore = useLocaleStore()

const shareCode = computed(() => {
  const code = route.params.shareCode
  return typeof code === 'string' ? code.trim() : ''
})

const loading = ref(true)
const submittingPassword = ref(false)
const sharedNote = ref<PublicSharedNote | null>(null)
const passwordRequired = ref(false)
const password = ref('')
const passwordError = ref('')
const errorCode = ref<'NOT_FOUND' | 'EXPIRED' | 'NETWORK' | null>(null)

const isExpired = computed(() => {
  if (!sharedNote.value?.expiresAt) return false
  return Date.now() > sharedNote.value.expiresAt
})

const renderedContent = computed(() => {
  if (!sharedNote.value?.content) return ''
  if (sharedNote.value.format === 'markdown') {
    return renderMarkdownSafe(sharedNote.value.content)
  }
  return sanitizeHtml(sharedNote.value.content)
})

async function fetchPublicNote(pwd?: string) {
  if (!shareCode.value) {
    errorCode.value = 'NOT_FOUND'
    loading.value = false
    return
  }

  loading.value = true
  passwordError.value = ''

  try {
    const res = await publicShareApi.get(shareCode.value, pwd)
    const noteData = res.note || res.share || null
    sharedNote.value = noteData

    const isPwdRequired = Boolean(
      res.requirePassword ||
      (noteData && noteData.requirePassword && !noteData.content)
    )

    if (isPwdRequired) {
      passwordRequired.value = true
    } else {
      passwordRequired.value = false
    }
    errorCode.value = null
  } catch (err: any) {
    const status = err?.status
    const code = err?.code || err?.data?.error?.code
    if (code === 'SHARE_PASSWORD_REQUIRED') {
      passwordRequired.value = true
      errorCode.value = null
    } else if (code === 'SHARE_EXPIRED' || status === 410) {
      errorCode.value = 'EXPIRED'
    } else if (code === 'SHARE_NOT_FOUND' || code === 'SHARE_DISABLED' || status === 404) {
      errorCode.value = 'NOT_FOUND'
    } else {
      errorCode.value = 'NETWORK'
    }
  } finally {
    loading.value = false
  }
}

async function handleUnlock() {
  if (!password.value.trim() || !shareCode.value) {
    passwordError.value = t('shares.passwordPlaceholder')
    return
  }

  submittingPassword.value = true
  passwordError.value = ''

  try {
    const res = await publicShareApi.access(shareCode.value, password.value.trim())
    const noteData = res.note || res.share || null
    sharedNote.value = noteData
    passwordRequired.value = false
    password.value = ''
    errorCode.value = null
  } catch (err: any) {
    const code = err?.code || err?.data?.error?.code
    if (code === 'SHARE_INVALID_PASSWORD') {
      passwordError.value = t('errors.SHARE_INVALID_PASSWORD')
    } else if (code === 'SHARE_EXPIRED') {
      errorCode.value = 'EXPIRED'
      passwordRequired.value = false
    } else {
      passwordError.value = t('errors.SHARE_INVALID_PASSWORD')
    }
  } finally {
    submittingPassword.value = false
  }
}

watch(
  () => shareCode.value,
  () => {
    fetchPublicNote()
  }
)

onMounted(() => {
  fetchPublicNote()
})
</script>

<template>
  <div class="min-h-screen flex flex-col bg-slate-50/60 text-slate-800 antialiased dark:bg-slate-950 dark:text-slate-100">
    <!-- 顶部常驻轻量导航栏 -->
    <header class="sticky top-0 z-30 border-b border-slate-200/80 bg-white/80 backdrop-blur px-4 py-3 sm:px-6 dark:border-slate-800 dark:bg-slate-900/80">
      <div class="mx-auto flex max-w-5xl items-center justify-between gap-4">
        <!-- Logo 与标题 -->
        <div class="flex items-center gap-3">
          <router-link to="/" class="flex items-center gap-2 hover:opacity-90 transition">
            <AppLogo />
            <span class="text-sm font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              {{ t('brand.name') }}
            </span>
          </router-link>
          <span class="hidden sm:inline-block rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-500 dark:bg-rose-500/15 dark:text-rose-300">
            {{ t('notes.shareActiveBadge') }}
          </span>
        </div>

        <!-- 控件区域 -->
        <div class="flex items-center gap-2">
          <ThemeToggle />
          <LocaleToggle />
          <router-link
            v-if="authStore.isAuthenticated"
            to="/"
            class="ml-1 inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 shadow-2xs hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <span>{{ t('auth.goWorkspace') }}</span>
          </router-link>
          <router-link
            v-else
            to="/login"
            class="ml-1 inline-flex items-center gap-1 rounded-lg bg-rose-500 px-3 py-1 text-xs font-medium text-white shadow-2xs hover:bg-rose-600 transition"
          >
            <span>{{ t('auth.loginButton') }}</span>
          </router-link>
        </div>
      </div>
    </header>

    <!-- 中间主体区域 -->
    <main class="flex-1 px-4 py-8 sm:px-6">
      <div class="mx-auto max-w-4xl">
        <!-- 1. 加载中骨架 -->
        <div v-if="loading" class="space-y-4 py-12 animate-pulse" data-testid="share-loading">
          <div class="h-8 w-2/3 rounded-lg bg-slate-200 dark:bg-slate-800" />
          <div class="h-4 w-1/3 rounded bg-slate-200 dark:bg-slate-800" />
          <div class="pt-6 space-y-3">
            <div class="h-4 w-full rounded bg-slate-200 dark:bg-slate-800" />
            <div class="h-4 w-5/6 rounded bg-slate-200 dark:bg-slate-800" />
            <div class="h-4 w-4/6 rounded bg-slate-200 dark:bg-slate-800" />
          </div>
        </div>

        <!-- 2. 分享链接已过期（410） -->
        <div
          v-else-if="errorCode === 'EXPIRED'"
          data-testid="share-expired"
          class="flex flex-col items-center justify-center rounded-3xl border border-slate-200/80 bg-white p-8 text-center shadow-xs dark:border-slate-800 dark:bg-slate-900 sm:p-14"
        >
          <div class="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 text-amber-500 dark:bg-amber-500/15">
            <el-icon :size="32"><Timer /></el-icon>
          </div>
          <h2 class="text-lg font-semibold text-slate-800 dark:text-slate-100">
            {{ t('shares.publicPage.expiredTitle') }}
          </h2>
          <p class="mt-2 max-w-md text-xs leading-relaxed text-slate-400">
            {{ t('shares.publicPage.expiredDesc') }}
          </p>
          <router-link
            to="/"
            class="mt-6 inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-200 transition dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <span>{{ t('brand.name') }}</span>
          </router-link>
        </div>

        <!-- 3. 分享不存在或已关闭（404） -->
        <div
          v-else-if="errorCode === 'NOT_FOUND'"
          data-testid="share-not-found"
          class="flex flex-col items-center justify-center rounded-3xl border border-slate-200/80 bg-white p-8 text-center shadow-xs dark:border-slate-800 dark:bg-slate-900 sm:p-14"
        >
          <div class="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-50 text-rose-500 dark:bg-rose-500/15">
            <el-icon :size="32"><Document /></el-icon>
          </div>
          <h2 class="text-lg font-semibold text-slate-800 dark:text-slate-100">
            {{ t('shares.publicPage.notFoundTitle') }}
          </h2>
          <p class="mt-2 max-w-md text-xs leading-relaxed text-slate-400">
            {{ t('shares.publicPage.notFoundDesc') }}
          </p>
          <router-link
            to="/"
            class="mt-6 inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-200 transition dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <span>{{ t('brand.name') }}</span>
          </router-link>
        </div>

        <!-- 4. 需要输入密码访问 -->
        <div
          v-else-if="passwordRequired"
          data-testid="share-password-box"
          class="mx-auto max-w-md rounded-3xl border border-slate-200/80 bg-white p-6 shadow-xl shadow-rose-500/5 dark:border-slate-800 dark:bg-slate-900 sm:p-8"
        >
          <div class="flex flex-col items-center text-center">
            <div class="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 text-rose-500 dark:bg-rose-500/15">
              <el-icon :size="28"><Lock /></el-icon>
            </div>
            <h2 class="text-base font-semibold text-slate-800 dark:text-slate-100">
              {{ sharedNote?.title || t('shares.publicPage.passwordRequiredTitle') }}
            </h2>
            <div v-if="sharedNote?.authorName" class="mt-1 flex items-center gap-1 text-xs text-slate-400">
              <el-icon :size="12"><UserIcon /></el-icon>
              <span>{{ t('shares.publicPage.authorPrefix') }}{{ sharedNote.authorName }}</span>
            </div>
            <p class="mt-2 text-xs text-slate-500 dark:text-slate-400">
              {{ t('shares.publicPage.passwordRequiredDesc') }}
            </p>
          </div>

          <form class="mt-6 space-y-3" @submit.prevent="handleUnlock">
            <div>
              <el-input
                v-model="password"
                type="password"
                show-password
                size="large"
                :prefix-icon="Key"
                :placeholder="t('shares.publicPage.passwordInputPlaceholder')"
                data-testid="share-password-entry"
                autocomplete="current-password"
              />
            </div>

            <div v-if="passwordError" class="flex items-center gap-1.5 text-xs text-rose-500">
              <el-icon><WarningFilled /></el-icon>
              <span>{{ passwordError }}</span>
            </div>

            <button
              type="submit"
              data-testid="share-submit-password-btn"
              :disabled="submittingPassword"
              class="flex w-full items-center justify-center gap-2 rounded-xl bg-rose-500 px-4 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-rose-600 active:scale-[0.99] disabled:opacity-60 transition"
            >
              <el-icon><Unlock /></el-icon>
              <span>{{ submittingPassword ? t('shares.publicPage.verifying') : t('shares.publicPage.submitPassword') }}</span>
            </button>
          </form>
        </div>

        <!-- 5. 正常展示已解锁/免密的笔记正文 -->
        <article
          v-else-if="sharedNote"
          data-testid="shared-note-article"
          class="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-10"
        >
          <!-- 笔记文章头部元数据 -->
          <header class="border-b border-slate-100 pb-6 dark:border-slate-800">
            <div class="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span class="inline-flex items-center gap-1">
                <el-icon><UserIcon /></el-icon>
                <span>{{ sharedNote.authorName }}</span>
              </span>
              <span>·</span>
              <span class="inline-flex items-center gap-1">
                <el-icon><Calendar /></el-icon>
                <span>{{ t('shares.publicPage.updatedAtPrefix') }}{{ formatDateTime(sharedNote.updatedAt || sharedNote.createdAt) }}</span>
              </span>
              <span>·</span>
              <span class="inline-flex items-center gap-1">
                <el-icon><View /></el-icon>
                <span>{{ t('shares.publicPage.viewCountPrefix') }}{{ sharedNote.viewCount }}</span>
              </span>
              <span
                class="ml-auto rounded-md px-2 py-0.5 text-[11px] font-medium"
                :class="
                  sharedNote.format === 'markdown'
                    ? 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300'
                    : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                "
              >
                {{ sharedNote.format === 'markdown' ? 'Markdown' : t('notes.formatPlain') }}
              </span>
            </div>

            <h1 class="mt-3 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl dark:text-slate-100">
              {{ sharedNote.title || t('notes.untitled') }}
            </h1>
          </header>

          <!-- 笔记正文安全渲染区域 -->
          <div
            class="candy-markdown-body candy-tiptap-content mt-6 min-h-[160px] text-slate-800 leading-relaxed dark:text-slate-200"
            data-testid="shared-note-content"
            v-html="renderedContent"
          />
        </article>

        <!-- 6. 加载异常或网络错误兜底提示卡片 -->
        <div
          v-else
          data-testid="share-network-error"
          class="flex flex-col items-center justify-center rounded-3xl border border-slate-200/80 bg-white p-8 text-center shadow-xs dark:border-slate-800 dark:bg-slate-900 sm:p-14"
        >
          <div class="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-50 text-rose-500 dark:bg-rose-500/15">
            <el-icon :size="32"><WarningFilled /></el-icon>
          </div>
          <h2 class="text-lg font-semibold text-slate-800 dark:text-slate-100">
            {{ t('errors.NETWORK_ERROR') }}
          </h2>
          <p class="mt-2 max-w-md text-xs leading-relaxed text-slate-400">
            {{ t('errors.INTERNAL_ERROR') }}
          </p>
          <button
            type="button"
            class="mt-6 inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-200 transition dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            @click="fetchPublicNote()"
          >
            <span>{{ t('common.refresh') }}</span>
          </button>
        </div>
      </div>
    </main>

    <!-- 底部版权信息 -->
    <footer class="border-t border-slate-200/80 bg-white/40 py-6 text-center text-xs text-slate-400 dark:border-slate-800/80 dark:bg-slate-950/40">
      <div class="flex items-center justify-center gap-2">
        <AppLogo />
        <span>{{ t('shares.publicPage.poweredBy') }}</span>
      </div>
    </footer>
  </div>
</template>
