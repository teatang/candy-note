<script setup lang="ts">
import { ElMessage, type FormInstance } from 'element-plus'
import { nextTick, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { resolveApiErrorMessage } from '@/api/client'
import { useAdminStore } from '@/stores/admin'
import type { User, UserRole, UserStatus } from '@/types'

/**
 * 后台手动添加/编辑用户弹窗组件
 * - 支持输入用户昵称（用户名）、电子邮箱、登录密码、账号角色与账号状态
 * - 打开时自动同步编辑对象并重置历史校验提示，关闭时销毁弹窗表单状态
 */
const props = defineProps<{
  modelValue: boolean
  editingUser: User | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void
}>()

const { t } = useI18n()
const adminStore = useAdminStore()
const formRef = ref<FormInstance>()
const submitting = ref(false)

const form = reactive({
  username: '',
  email: '',
  password: '',
  role: 'user' as UserRole,
  status: 'active' as UserStatus
})

watch(
  () => props.modelValue,
  async (open) => {
    if (!open) return
    if (props.editingUser) {
      form.username = props.editingUser.username
      form.email = props.editingUser.email
      form.password = ''
      form.role = props.editingUser.role
      form.status = props.editingUser.status
    } else {
      form.username = ''
      form.email = ''
      form.password = ''
      form.role = 'user'
      form.status = 'active'
    }
    await nextTick()
    formRef.value?.clearValidate()
  }
)

async function handleSubmit() {
  submitting.value = true
  try {
    if (props.editingUser) {
      await adminStore.updateUser(props.editingUser.id, {
        username: form.username.trim(),
        email: form.email.trim(),
        password: form.password ? form.password : undefined,
        role: form.role,
        status: form.status
      })
      ElMessage.success(t('admin.userUpdated'))
    } else {
      await adminStore.createUser({
        username: form.username.trim(),
        email: form.email.trim(),
        password: form.password,
        role: form.role,
        status: form.status
      })
      ElMessage.success(t('admin.userCreated'))
    }
    emit('update:modelValue', false)
  } catch (err) {
    ElMessage.error(resolveApiErrorMessage(err))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="editingUser ? t('admin.editUser') : t('admin.addUser')"
    width="min(440px, 92vw)"
    top="8vh"
    append-to-body
    destroy-on-close
    @update:model-value="(val: boolean) => emit('update:modelValue', val)"
  >
    <el-form ref="formRef" :model="form" label-position="top" @submit.prevent="handleSubmit">
      <el-form-item :label="t('admin.form.username')" prop="username" required>
        <el-input
          v-model="form.username"
          :placeholder="t('admin.form.usernamePlaceholder')"
          maxlength="32"
          autocomplete="off"
        />
      </el-form-item>

      <el-form-item :label="t('admin.form.email')" prop="email" required>
        <el-input
          v-model="form.email"
          type="email"
          :placeholder="t('admin.form.emailPlaceholder')"
          autocomplete="off"
        />
      </el-form-item>

      <el-form-item :label="t('admin.form.password')" prop="password" :required="!editingUser">
        <el-input
          v-model="form.password"
          type="password"
          show-password
          autocomplete="new-password"
          :placeholder="
            editingUser
              ? t('admin.form.passwordPlaceholderEdit')
              : t('admin.form.passwordPlaceholderCreate')
          "
        />
      </el-form-item>

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <el-form-item :label="t('admin.form.role')" prop="role">
          <el-select v-model="form.role" class="w-full">
            <el-option :label="t('admin.roleUser')" value="user" />
            <el-option :label="t('admin.roleAdmin')" value="admin" />
          </el-select>
        </el-form-item>

        <el-form-item :label="t('admin.form.status')" prop="status">
          <el-select v-model="form.status" class="w-full">
            <el-option :label="t('admin.statusActive')" value="active" />
            <el-option :label="t('admin.statusDisabled')" value="disabled" />
          </el-select>
        </el-form-item>
      </div>

      <div class="mt-2 flex justify-end gap-2">
        <el-button @click="emit('update:modelValue', false)">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="submitting" native-type="submit">
          {{ t('common.confirm') }}
        </el-button>
      </div>
    </el-form>
  </el-dialog>
</template>
