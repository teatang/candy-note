<script setup lang="ts">
import { Delete, Edit, Plus, Refresh, Search, Warning } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { resolveApiErrorMessage } from '@/api/client'
import StatsOverview from '@/components/admin/StatsOverview.vue'
import UserFormDialog from '@/components/admin/UserFormDialog.vue'
import AppHeader from '@/components/layout/AppHeader.vue'
import { useAdminStore } from '@/stores/admin'
import { useAuthStore } from '@/stores/auth'
import { useLocaleStore } from '@/stores/locale'
import type { User } from '@/types'
import { formatBytes, formatDateTime } from '@/utils/date'

/**
 * 糖果笔记系统管理后台视图
 * - 展示核心统计信息（用户/笔记/格式/文件夹/7天版本/R2存储）
 * - 查看各用户资源占用及最近登录信息
 * - 手动添加新用户、修改权限/状态、重置密码、删除用户（禁止前台注册）
 */
const { t } = useI18n()
const adminStore = useAdminStore()
const authStore = useAuthStore()
const localeStore = useLocaleStore()

const activeTab = ref<'users' | 'usage'>('users')
const userDialogOpen = ref(false)
const editingUser = ref<User | null>(null)

function openAddUser() {
  editingUser.value = null
  userDialogOpen.value = true
}

function openEditUser(user: User) {
  editingUser.value = user
  userDialogOpen.value = true
}

async function handleDeleteUser(user: User) {
  try {
    await ElMessageBox.confirm(
      t('admin.deleteUserConfirm', { username: user.username }),
      t('common.delete'),
      {
        type: 'warning',
        confirmButtonText: t('common.delete'),
        cancelButtonText: t('common.cancel')
      }
    )
    await adminStore.deleteUser(user.id)
    ElMessage.success(t('admin.userDeleted'))
  } catch (err) {
    if (err !== 'cancel' && err !== 'close') {
      ElMessage.error(resolveApiErrorMessage(err))
    }
  }
}

async function handleRefresh() {
  try {
    await adminStore.loadAll()
  } catch (err) {
    ElMessage.error(resolveApiErrorMessage(err))
  }
}

onMounted(() => {
  handleRefresh()
})
</script>

<template>
  <div class="flex min-h-screen flex-col bg-slate-50 dark:bg-slate-950">
    <AppHeader />

    <div class="mx-auto w-full max-w-6xl flex-1 space-y-6 px-4 py-6 sm:px-6">
      <!-- 初始化默认密码安全提示 -->
      <div
        v-if="authStore.user?.mustChangePassword"
        class="flex items-center gap-2.5 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
      >
        <el-icon :size="16"><Warning /></el-icon>
        <span>{{ t('auth.defaultPasswordAlert') }}</span>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-xl font-bold text-slate-900 dark:text-slate-100">
            {{ t('admin.title') }}
          </h1>
          <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {{ t('admin.subtitle') }}
          </p>
        </div>

        <div class="flex items-center gap-2">
          <el-button size="small" :loading="adminStore.loading" @click="handleRefresh">
            <el-icon class="mr-1"><Refresh /></el-icon>
            <span>{{ t('common.refresh') }}</span>
          </el-button>
          <el-button size="small" type="primary" @click="openAddUser">
            <el-icon class="mr-1"><Plus /></el-icon>
            <span>{{ t('admin.addUser') }}</span>
          </el-button>
        </div>
      </div>

      <!-- 核心统计指标概览 -->
      <StatsOverview v-if="adminStore.stats" :stats="adminStore.stats" />

      <!-- 用户管理与资源统计页签 -->
      <div
        class="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900"
      >
        <el-tabs v-model="activeTab">
          <el-tab-pane :label="t('admin.tabs.users')" name="users">
            <div class="mb-4 flex flex-wrap items-center gap-3">
              <el-input
                v-model="adminStore.searchQuery"
                size="small"
                clearable
                :prefix-icon="Search"
                :placeholder="t('admin.searchUsers')"
                class="!w-64"
                @input="adminStore.fetchUsers()"
              />
              <el-select
                v-model="adminStore.statusFilter"
                size="small"
                class="!w-36"
                @change="adminStore.fetchUsers()"
              >
                <el-option :label="t('admin.allStatuses')" value="all" />
                <el-option :label="t('admin.statusActive')" value="active" />
                <el-option :label="t('admin.statusDisabled')" value="disabled" />
              </el-select>
            </div>

            <el-table :data="adminStore.users" v-loading="adminStore.loading" stripe>
              <el-table-column :label="t('admin.table.user')" min-width="200">
                <template #default="{ row }">
                  <div class="font-medium text-slate-800 dark:text-slate-100">
                    {{ row.username }}
                  </div>
                  <div class="text-xs text-slate-400">{{ row.email }}</div>
                </template>
              </el-table-column>

              <el-table-column :label="t('admin.table.role')" width="110">
                <template #default="{ row }">
                  <el-tag :type="row.role === 'admin' ? 'danger' : 'info'" size="small">
                    {{ row.role === 'admin' ? t('admin.roleAdmin') : t('admin.roleUser') }}
                  </el-tag>
                </template>
              </el-table-column>

              <el-table-column :label="t('admin.table.status')" width="100">
                <template #default="{ row }">
                  <el-tag :type="row.status === 'active' ? 'success' : 'warning'" size="small">
                    {{
                      row.status === 'active'
                        ? t('admin.statusActive')
                        : t('admin.statusDisabled')
                    }}
                  </el-tag>
                </template>
              </el-table-column>

              <el-table-column :label="t('admin.table.lastLogin')" min-width="160">
                <template #default="{ row }">
                  <span class="text-xs text-slate-500">
                    {{
                      row.lastLoginAt
                        ? formatDateTime(row.lastLoginAt, localeStore.locale)
                        : t('admin.table.neverLogin')
                    }}
                  </span>
                </template>
              </el-table-column>

              <el-table-column :label="t('admin.table.createdAt')" min-width="160">
                <template #default="{ row }">
                  <span class="text-xs text-slate-500">
                    {{ formatDateTime(row.createdAt, localeStore.locale) }}
                  </span>
                </template>
              </el-table-column>

              <el-table-column :label="t('common.actions')" width="150" fixed="right">
                <template #default="{ row }">
                  <el-button size="small" text type="primary" @click="openEditUser(row)">
                    <el-icon><Edit /></el-icon>
                  </el-button>
                  <el-button
                    size="small"
                    text
                    type="danger"
                    :disabled="row.id === authStore.user?.id"
                    @click="handleDeleteUser(row)"
                  >
                    <el-icon><Delete /></el-icon>
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>

          <el-tab-pane :label="t('admin.tabs.usage')" name="usage">
            <el-table :data="adminStore.stats?.userSummaries ?? []" stripe>
              <el-table-column :label="t('admin.table.user')" min-width="200">
                <template #default="{ row }">
                  <div class="font-medium text-slate-800 dark:text-slate-100">
                    {{ row.username }}
                  </div>
                  <div class="text-xs text-slate-400">{{ row.email }}</div>
                </template>
              </el-table-column>
              <el-table-column
                prop="noteCount"
                :label="t('admin.table.notesCount')"
                width="100"
                align="center"
              />
              <el-table-column
                prop="folderCount"
                :label="t('admin.table.foldersCount')"
                width="100"
                align="center"
              />
              <el-table-column
                prop="attachmentCount"
                :label="t('admin.table.attachmentsCount')"
                width="100"
                align="center"
              />
              <el-table-column :label="t('admin.table.storageUsed')" width="130">
                <template #default="{ row }">
                  <span class="text-xs font-mono">{{ formatBytes(row.storageBytes) }}</span>
                </template>
              </el-table-column>
              <el-table-column :label="t('admin.table.lastLogin')" min-width="160">
                <template #default="{ row }">
                  <span class="text-xs text-slate-500">
                    {{
                      row.lastLoginAt
                        ? formatDateTime(row.lastLoginAt, localeStore.locale)
                        : t('admin.table.neverLogin')
                    }}
                  </span>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>
        </el-tabs>
      </div>
    </div>

    <UserFormDialog v-model="userDialogOpen" :editing-user="editingUser" />
  </div>
</template>
