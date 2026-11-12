import { defineStore } from 'pinia'
import { ref } from 'vue'
import { adminApi } from '@/api/admin'
import type { AdminStats, User, UserRole, UserStatus } from '@/types'

/**
 * 管理后台状态仓库
 * 负责拉取平台核心统计数据与执行用户账号的手动新增、修改和删除
 */
export const useAdminStore = defineStore('admin', () => {
  const stats = ref<AdminStats | null>(null)
  const users = ref<User[]>([])
  const loading = ref(false)
  const searchQuery = ref('')
  const statusFilter = ref<'all' | UserStatus>('all')

  /** 加载管理后台统计概览 */
  async function fetchStats() {
    const res = await adminApi.getStats()
    stats.value = res.stats
    return res.stats
  }

  /** 加载用户列表 */
  async function fetchUsers() {
    const res = await adminApi.listUsers({
      q: searchQuery.value.trim(),
      status: statusFilter.value
    })
    users.value = res.users
    return res.users
  }

  /** 并行刷新概览与用户列表 */
  async function loadAll() {
    loading.value = true
    try {
      await Promise.all([fetchStats(), fetchUsers()])
    } finally {
      loading.value = false
    }
  }

  /** 手动添加新用户 */
  async function createUser(payload: {
    username: string
    email: string
    password: string
    role: UserRole
    status: UserStatus
  }) {
    const res = await adminApi.createUser(payload)
    await loadAll()
    return res.user
  }

  /** 更新用户信息或重置密码 */
  async function updateUser(
    id: string,
    payload: {
      username?: string
      email?: string
      password?: string
      role?: UserRole
      status?: UserStatus
    }
  ) {
    const res = await adminApi.updateUser(id, payload)
    await loadAll()
    return res.user
  }

  /** 删除用户并清理关联 R2 存储 */
  async function deleteUser(id: string) {
    await adminApi.deleteUser(id)
    await loadAll()
  }

  return {
    stats,
    users,
    loading,
    searchQuery,
    statusFilter,
    fetchStats,
    fetchUsers,
    loadAll,
    createUser,
    updateUser,
    deleteUser
  }
})
