import type {
  Note,
  NoteFormat,
  NoteVersion,
  NoteShare,
  SaveNoteSharePayload,
  PublicSharedNote
} from '@/types'
import { apiRequest } from './client'

/** 笔记与一周历史版本、分享接口封装 */
export const notesApi = {
  list(params: { folderId?: string; q?: string; format?: string } = {}) {
    const sp = new URLSearchParams()
    if (params.folderId) sp.set('folderId', params.folderId)
    if (params.q) sp.set('q', params.q)
    if (params.format && params.format !== 'all') sp.set('format', params.format)
    const qs = sp.toString()
    return apiRequest<{ notes: Note[] }>(`/api/notes${qs ? `?${qs}` : ''}`)
  },

  get(id: string) {
    return apiRequest<{ note: Note }>(`/api/notes/${id}`)
  },

  create(payload: {
    title?: string
    content?: string
    format: NoteFormat
    folderId?: string | null
    isPinned?: boolean
  }) {
    return apiRequest<{ note: Note }>('/api/notes', {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  },

  update(
    id: string,
    payload: {
      title?: string
      content?: string
      format?: NoteFormat
      folderId?: string | null
      isPinned?: boolean
      changeType?: 'save' | 'auto_save'
      createVersion?: boolean
      expectedUpdatedAt?: number
      confirmConflict?: boolean
    }
  ) {
    return apiRequest<{ note: Note }>(`/api/notes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    })
  },

  reorder(
    items: Array<{
      id: string
      sortOrder: number
      folderId?: string | null
      isPinned?: boolean
    }>
  ) {
    return apiRequest<{ ok: true }>('/api/notes/reorder', {
      method: 'PATCH',
      body: JSON.stringify({ items })
    })
  },

  remove(id: string) {
    return apiRequest<{ ok: true }>(`/api/notes/${id}`, {
      method: 'DELETE'
    })
  },

  listVersions(noteId: string) {
    return apiRequest<{ versions: NoteVersion[] }>(`/api/notes/${noteId}/versions`)
  },

  rollbackVersion(noteId: string, versionId: string) {
    return apiRequest<{ note: Note; restoredFromVersionId: string }>(
      `/api/notes/${noteId}/versions/${versionId}/rollback`,
      { method: 'POST' }
    )
  },

  /** 获取指定笔记的分享配置 */
  getShare(noteId: string) {
    return apiRequest<{ share: NoteShare | null }>(`/api/notes/${noteId}/share`)
  },

  /** 创建或更新笔记分享配置 */
  saveShare(noteId: string, payload: SaveNoteSharePayload) {
    return apiRequest<{ share: NoteShare }>(`/api/notes/${noteId}/share`, {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  },

  /** 删除/取消笔记分享 */
  deleteShare(noteId: string) {
    return apiRequest<{ ok: true }>(`/api/notes/${noteId}/share`, {
      method: 'DELETE'
    })
  }
}

/** 外部公开免登录访问笔记接口封装 */
export const publicShareApi = {
  get(shareCode: string, password?: string) {
    const qs = password ? `?password=${encodeURIComponent(password)}` : ''
    return apiRequest<{
      ok: boolean
      requirePassword?: boolean
      note?: PublicSharedNote
      share?: PublicSharedNote
    }>(`/api/share/${shareCode}${qs}`, {
      skipUnauthorizedCallback: true
    })
  },

  access(shareCode: string, password: string) {
    return apiRequest<{
      ok: boolean
      requirePassword?: boolean
      note?: PublicSharedNote
      share?: PublicSharedNote
    }>(`/api/share/${shareCode}/access`, {
      method: 'POST',
      body: JSON.stringify({ password }),
      skipUnauthorizedCallback: true
    })
  }
}

