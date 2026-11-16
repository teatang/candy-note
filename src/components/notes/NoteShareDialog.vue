<script setup lang="ts">
import {
  Check,
  Close,
  CopyDocument,
  Key,
  Lock,
  Share,
  Timer,
  TopRight,
  Unlock,
  View
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { notesApi } from '@/api/notes'
import { resolveApiErrorMessage } from '@/api/client'
import { useLocaleStore } from '@/stores/locale'
import type { Note, NoteShare, ShareDurationType } from '@/types'
import { formatDateTime } from '@/utils/date'

const props = defineProps<{
  modelValue: boolean
  note: Note | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'share-updated', share: NoteShare | null): void
}>()

const { t } = useI18n()
const localeStore = useLocaleStore()

const loading = ref(false)
const submitting = ref(false)
const share = ref<NoteShare | null>(null)

// 表单响应状态
const isEnabled = ref(false)
const duration = ref<ShareDurationType>('permanent')
const hasPassword = ref(false)
const password = ref('')

const isExpired = computed(() => {
  if (!share.value || !share.value.expiresAt) return false
  return Date.now() > share.value.expiresAt
})

const shareUrl = computed(() => {
  if (!share.value?.shareCode) return ''
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/share/${share.value.shareCode}`
  }
  return `/share/${share.value.shareCode}`
})

watch(
  () => props.modelValue,
  async (isOpen) => {
    if (isOpen && props.note) {
      await fetchShareConfig()
    } else {
      password.value = ''
    }
  },
  { immediate: true }
)

async function fetchShareConfig() {
  if (!props.note) return
  loading.value = true
  try {
    const res = await notesApi.getShare(props.note.id)
    share.value = res.share
    if (res.share) {
      isEnabled.value = res.share.isEnabled
      hasPassword.value = res.share.hasPassword
      if (!res.share.expiresAt) {
        duration.value = 'permanent'
      } else {
        duration.value = '7d' // 默认选项保留，保存时可重新指定时长
      }
    } else {
      isEnabled.value = false
      hasPassword.value = false
      duration.value = 'permanent'
    }
    password.value = ''
  } catch (err) {
    ElMessage.error(resolveApiErrorMessage(err))
  } finally {
    loading.value = false
  }
}

async function handleSave() {
  if (!props.note) return

  if (hasPassword.value) {
    // 若原先没有密码或用户输入了新密码，做长度校验
    if (!share.value?.hasPassword && !password.value.trim()) {
      ElMessage.warning(t('shares.passwordPlaceholder'))
      return
    }
    if (password.value && (password.value.length < 4 || password.value.length > 32)) {
      ElMessage.warning(t('shares.passwordPlaceholder'))
      return
    }
  }

  submitting.value = true
  try {
    const res = await notesApi.saveShare(props.note.id, {
      isEnabled: isEnabled.value,
      duration: duration.value,
      hasPassword: hasPassword.value,
      password: password.value.trim() || undefined
    })
    share.value = res.share
    password.value = ''
    ElMessage.success(t('shares.saveShareSuccess'))
    emit('share-updated', res.share)
  } catch (err) {
    ElMessage.error(resolveApiErrorMessage(err))
  } finally {
    submitting.value = false
  }
}

async function handleDisableShare() {
  if (!props.note) return
  try {
    await ElMessageBox.confirm(
      t('shares.disableShareConfirm'),
      t('shares.dialogTitle'),
      {
        type: 'warning',
        confirmButtonText: t('common.confirm'),
        cancelButtonText: t('common.cancel')
      }
    )

    submitting.value = true
    await notesApi.deleteShare(props.note.id)
    share.value = null
    isEnabled.value = false
    hasPassword.value = false
    password.value = ''
    ElMessage.success(t('shares.deleteShareSuccess'))
    emit('share-updated', null)
  } catch (err) {
    if (err !== 'cancel' && err !== 'close') {
      ElMessage.error(resolveApiErrorMessage(err))
    }
  } finally {
    submitting.value = false
  }
}

async function copyText(text: string, successMessage: string) {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
    } else {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
    ElMessage.success(successMessage)
  } catch {
    ElMessage.error(t('shares.copyFailed'))
  }
}

function handleCopyLink() {
  if (!shareUrl.value) return
  copyText(shareUrl.value, t('shares.copiedLinkMsg'))
}

function handleCopyLinkAndPwd() {
  if (!shareUrl.value) return
  const pwdText = password.value.trim()
  const content = pwdText
    ? `${shareUrl.value} (${t('shares.passwordLabel')}: ${pwdText})`
    : shareUrl.value
  copyText(content, t('shares.copiedLinkAndPwdMsg'))
}

function handleOpenPreview() {
  if (shareUrl.value) {
    window.open(shareUrl.value, '_blank')
  }
}

function handleClose() {
  emit('update:modelValue', false)
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :width="'min(560px, 95vw)'"
    :show-close="false"
    append-to-body
    class="candy-share-dialog rounded-2xl overflow-hidden"
    @update:model-value="(val: boolean) => !val && handleClose()"
  >
    <template #header="{ titleId }">
      <div class="flex items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
        <div class="flex items-center gap-2">
          <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-500 dark:bg-rose-500/15">
            <el-icon :size="18"><Share /></el-icon>
          </div>
          <div>
            <h3 :id="titleId" class="text-sm font-semibold text-slate-800 dark:text-slate-100">
              {{ t('shares.dialogTitle') }}
            </h3>
            <p class="text-xs text-slate-400">
              {{ t('shares.dialogDesc') }}
            </p>
          </div>
        </div>
        <button
          type="button"
          class="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
          @click="handleClose"
        >
          <el-icon :size="16"><Close /></el-icon>
        </button>
      </div>
    </template>

    <div v-loading="loading" class="py-2 space-y-4">
      <!-- 开启分享总开关 -->
      <div
        class="flex items-center justify-between rounded-xl bg-slate-50 p-3.5 dark:bg-slate-900/60 cursor-pointer select-none"
        data-testid="share-enabled-card"
        @click="isEnabled = !isEnabled"
      >
        <div class="space-y-0.5">
          <div class="text-xs font-medium text-slate-800 dark:text-slate-200">
            {{ t('shares.enableShare') }}
          </div>
          <div class="text-[11px] text-slate-400 leading-relaxed">
            {{ t('shares.enableShareDesc') }}
          </div>
        </div>
        <el-switch
          :model-value="isEnabled"
          active-color="#f43f5e"
          data-testid="share-enabled-switch"
          @click.stop="isEnabled = !isEnabled"
        />
      </div>

      <!-- 分享配置面板（仅当开启分享时显示） -->
      <div v-if="isEnabled" class="space-y-4">
        <!-- 分享有效期配置 -->
        <div class="space-y-2">
          <div class="flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300">
            <el-icon class="text-slate-400"><Timer /></el-icon>
            <span>{{ t('shares.durationLabel') }}</span>
          </div>
          <div class="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
            <button
              v-for="dur in ['permanent', '1h', '1d', '7d', '30d'] as ShareDurationType[]"
              :key="dur"
              type="button"
              :data-testid="`duration-${dur}`"
              class="rounded-lg border px-2.5 py-1.5 text-xs font-medium transition text-center"
              :class="
                duration === dur
                  ? 'border-rose-500 bg-rose-50 text-rose-600 dark:border-rose-400 dark:bg-rose-500/15 dark:text-rose-300'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
              "
              @click="duration = dur"
            >
              {{ t(`shares.durations.${dur}`) }}
            </button>
          </div>
        </div>

        <!-- 密码保护配置 -->
        <div class="space-y-2 rounded-xl border border-slate-200/80 p-3.5 dark:border-slate-800">
          <div
            class="flex items-center justify-between cursor-pointer select-none"
            data-testid="share-password-header"
            @click="hasPassword = !hasPassword"
          >
            <div class="flex items-center gap-1.5">
              <el-icon class="text-slate-400">
                <Lock v-if="hasPassword" />
                <Unlock v-else />
              </el-icon>
              <div class="text-xs font-medium text-slate-700 dark:text-slate-300">
                {{ t('shares.passwordLabel') }}
              </div>
            </div>
            <el-switch
              :model-value="hasPassword"
              active-color="#f43f5e"
              size="small"
              data-testid="share-password-switch"
              @click.stop="hasPassword = !hasPassword"
            />
          </div>
          <p class="text-[11px] text-slate-400">
            {{ t('shares.passwordDesc') }}
          </p>

          <div v-if="hasPassword" class="pt-1" data-testid="share-password-container">
            <el-input
              v-model="password"
              type="password"
              show-password
              size="small"
              data-testid="share-password-input"
              :placeholder="
                share?.hasPassword
                  ? t('shares.passwordPlaceholderKeep')
                  : t('shares.passwordPlaceholder')
              "
            >
              <template #prefix>
                <el-icon class="text-slate-400"><Key /></el-icon>
              </template>
            </el-input>
          </div>
        </div>

        <!-- 当前分享链接展示与一键复制 -->
        <div v-if="share && share.isEnabled" class="space-y-2 rounded-xl bg-slate-50 p-3.5 dark:bg-slate-900/60">
          <div class="flex items-center justify-between text-xs font-medium text-slate-700 dark:text-slate-300">
            <span class="flex items-center gap-1.5">
              <span
                class="inline-block h-2 w-2 rounded-full"
                :class="isExpired ? 'bg-amber-400' : 'bg-emerald-500'"
              />
              <span>{{ isExpired ? t('shares.statusExpired') : t('shares.statusActive') }}</span>
            </span>
            <span class="text-[11px] font-normal text-slate-400">
              <el-icon class="mr-0.5 align-middle"><View /></el-icon>
              {{ t('shares.statsViews', { count: share.viewCount }) }}
            </span>
          </div>

          <div class="flex items-center gap-1.5">
            <el-input
              :model-value="shareUrl"
              readonly
              size="small"
              data-testid="share-url-input"
              class="flex-1 font-mono text-xs"
            />
            <el-button
              size="small"
              data-testid="copy-share-url-btn"
              @click="handleCopyLink"
            >
              <el-icon class="mr-1"><CopyDocument /></el-icon>
              <span>{{ t('shares.copyLinkBtn') }}</span>
            </el-button>
            <el-button
              size="small"
              type="primary"
              plain
              data-testid="open-share-preview-btn"
              @click="handleOpenPreview"
            >
              <el-icon><TopRight /></el-icon>
            </el-button>
          </div>

          <div class="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-slate-400">
            <div>
              <template v-if="share.expiresAt">
                {{ t('shares.expiresAtText', { time: formatDateTime(share.expiresAt) }) }}
              </template>
              <template v-else>
                {{ t('shares.neverExpires') }}
              </template>
            </div>
            <button
              v-if="hasPassword && password"
              type="button"
              data-testid="copy-link-and-pwd-btn"
              class="text-rose-500 hover:underline"
              @click="handleCopyLinkAndPwd"
            >
              {{ t('shares.copyLinkAndPwdBtn') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex items-center justify-between border-t border-slate-100 pt-3 dark:border-slate-800">
        <div>
          <el-button
            v-if="share"
            size="small"
            type="danger"
            plain
            :disabled="submitting"
            data-testid="disable-share-btn"
            @click="handleDisableShare"
          >
            {{ t('common.delete') }}
          </el-button>
        </div>
        <div class="flex items-center gap-2">
          <el-button size="small" :disabled="submitting" @click="handleClose">
            {{ t('common.cancel') }}
          </el-button>
          <el-button
            size="small"
            type="primary"
            :loading="submitting"
            data-testid="save-share-btn"
            @click="handleSave"
          >
            <el-icon class="mr-1"><Check /></el-icon>
            <span>{{ t('common.save') }}</span>
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
:deep(.candy-share-dialog .el-dialog__body) {
  padding: 12px 20px;
}
</style>
