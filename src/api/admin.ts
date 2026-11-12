import type { AdminStats, User, UserRole, UserStatus } from '@/types'
import { apiRequest } from './client'

/** 管理后台接口封装 */
export const adminApi = {
  getStats() {
    return apiRequest<{ stats: AdminStats }>('/api/admin/stats')
  },

  listUsers(params: { q?: string; status?: string } = {}) {
    const sp = new URLSearchParams()
    if (params.q) sp.set('q', params.q)
    if (params.status && params.status !== 'all') sp.set('status', params.status)
    const qs = sp.toString()
    return apiRequest<{ users: User[] }>(`/api/admin/users${qs ? `?${qs}` : ''}`)
  },

  createUser(payload: {
    username: string
    email: string
    password: string
    role: UserRole
    status: UserStatus
  }) {
    return apiRequest<{ user: User }>('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  },

  updateUser(
    id: string,
    payload: {
      username?: string
      email?: string
      password?: string
      role?: UserRole
      status?: UserStatus
    }
  ) {
    return apiRequest<{ user: User }>(`/api/admin/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    })
  },

  deleteUser(id: string) {
    return apiRequest<{ ok: true }>(`/api/admin/users/${id}`, {
      method: 'DELETE'
    })
  }
}
