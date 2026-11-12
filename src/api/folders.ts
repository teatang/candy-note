import type { Folder } from '@/types'
import { apiRequest } from './client'

/** 文件夹管理接口封装 */
export const foldersApi = {
  list() {
    return apiRequest<{ folders: Folder[] }>('/api/folders')
  },

  create(payload: { name: string; parentId?: string | null }) {
    return apiRequest<{ folder: Folder }>('/api/folders', {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  },

  update(id: string, payload: { name?: string; parentId?: string | null }) {
    return apiRequest<{ folder: Folder }>(`/api/folders/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    })
  },

  reorder(items: Array<{ id: string; sortOrder: number; parentId?: string | null }>) {
    return apiRequest<{ ok: true }>('/api/folders/reorder', {
      method: 'PATCH',
      body: JSON.stringify({ items })
    })
  },

  remove(id: string) {
    return apiRequest<{ ok: true; deletedIds: string[] }>(`/api/folders/${id}`, {
      method: 'DELETE'
    })
  }
}
