import type { Attachment } from '@/types'
import { apiRequest } from './client'

/** Cloudflare R2 图片附件接口封装 */
export const filesApi = {
  upload(file: File, noteId?: string | null) {
    const formData = new FormData()
    formData.append('file', file)
    if (noteId) {
      formData.append('noteId', noteId)
    }
    return apiRequest<{ attachment: Attachment }>('/api/files/upload', {
      method: 'POST',
      body: formData
    })
  },

  listByNote(noteId: string) {
    return apiRequest<{ attachments: Attachment[] }>(`/api/files/note/${noteId}`)
  },

  remove(id: string) {
    return apiRequest<{ ok: true }>(`/api/files/${id}`, {
      method: 'DELETE'
    })
  }
}
