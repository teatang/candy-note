import { i18n } from '@/i18n'

/**
 * 自定义 API 业务异常类，携带后端错误码与 HTTP 状态码
 */
export class ApiRequestError extends Error {
  code: string
  status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'ApiRequestError'
    this.code = code
    this.status = status
  }
}

/**
 * 将后端错误码转换为当前语言环境下的友好提示文案
 */
export function resolveApiErrorMessage(err: unknown): string {
  if (err instanceof ApiRequestError) {
    const t = i18n.global.t
    const key = `errors.${err.code}`
    const translated = t(key)
    if (translated && translated !== key) {
      return translated
    }
    return err.message || t('errors.INTERNAL_ERROR')
  }
  if (err instanceof Error) {
    return err.message
  }
  return i18n.global.t('errors.NETWORK_ERROR')
}

/** 未授权事件订阅回调（用于会话过期时统一跳转登录页） */
let unauthorizedHandler: (() => void) | null = null

export function onUnauthorized(handler: () => void): void {
  unauthorizedHandler = handler
}

/**
 * 统一封装 fetch 请求，自动携带 Cookie 凭证并解析标准 JSON 响应
 */
export async function apiRequest<T>(
  url: string,
  options: RequestInit & { skipUnauthorizedCallback?: boolean } = {}
): Promise<T> {
  const { skipUnauthorizedCallback, ...fetchOptions } = options
  const headers = new Headers(fetchOptions.headers)

  if (
    fetchOptions.body &&
    !(fetchOptions.body instanceof FormData) &&
    !headers.has('Content-Type')
  ) {
    headers.set('Content-Type', 'application/json')
  }

  let res: Response
  try {
    res = await fetch(url, {
      ...fetchOptions,
      headers,
      credentials: 'include'
    })
  } catch {
    throw new ApiRequestError('NETWORK_ERROR', 'Network request failed', 0)
  }

  const data = (await res.json().catch(() => null)) as
    | ({ ok?: boolean; code?: string; message?: string } & T)
    | null

  if (!res.ok || (data && data.ok === false)) {
    const code = data?.code || (res.status === 401 ? 'AUTH_UNAUTHORIZED' : 'INTERNAL_ERROR')
    const message = data?.message || `HTTP ${res.status}`
    if (res.status === 401 && !skipUnauthorizedCallback && unauthorizedHandler) {
      unauthorizedHandler()
    }
    throw new ApiRequestError(code, message, res.status)
  }

  return (data ?? {}) as T
}
