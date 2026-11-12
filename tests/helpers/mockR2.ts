/**
 * 内存版 Cloudflare R2Bucket 模拟适配器
 * 支持 put / get / delete 操作及流式 body 读取，用于测试图片上传、读取与联动清理
 */
interface StoredObject {
  data: Uint8Array
  httpMetadata?: R2HTTPMetadata
  customMetadata?: Record<string, string>
  uploaded: Date
}

export class MockR2Bucket {
  readonly store = new Map<string, StoredObject>()

  async put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob | null,
    options?: R2PutOptions
  ): Promise<R2Object> {
    let bytes: Uint8Array
    if (value === null) {
      bytes = new Uint8Array(0)
    } else if (typeof value === 'string') {
      bytes = new TextEncoder().encode(value)
    } else if (value instanceof ArrayBuffer) {
      bytes = new Uint8Array(value)
    } else if (ArrayBuffer.isView(value)) {
      bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    } else if (value instanceof Blob) {
      bytes = new Uint8Array(await value.arrayBuffer())
    } else {
      const reader = value.getReader()
      const chunks: Uint8Array[] = []
      let total = 0
      while (true) {
        const { done, value: chunk } = await reader.read()
        if (done) break
        chunks.push(chunk)
        total += chunk.byteLength
      }
      bytes = new Uint8Array(total)
      let offset = 0
      for (const c of chunks) {
        bytes.set(c, offset)
        offset += c.byteLength
      }
    }

    const record: StoredObject = {
      data: bytes,
      httpMetadata: options?.httpMetadata as R2HTTPMetadata | undefined,
      customMetadata: options?.customMetadata,
      uploaded: new Date()
    }
    this.store.set(key, record)

    return {
      key,
      version: 'mock-v1',
      size: bytes.byteLength,
      etag: 'mock-etag',
      httpEtag: '"mock-etag"',
      uploaded: record.uploaded,
      httpMetadata: record.httpMetadata ?? {},
      customMetadata: record.customMetadata ?? {},
      checksums: { toJSON: () => ({}) },
      storageClass: 'Standard',
      writeHttpMetadata: () => {}
    } as unknown as R2Object
  }

  async get(key: string): Promise<R2ObjectBody | null> {
    const record = this.store.get(key)
    if (!record) return null

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(record.data)
        controller.close()
      }
    })

    return {
      key,
      version: 'mock-v1',
      size: record.data.byteLength,
      etag: 'mock-etag',
      httpEtag: '"mock-etag"',
      uploaded: record.uploaded,
      httpMetadata: record.httpMetadata ?? {},
      customMetadata: record.customMetadata ?? {},
      checksums: { toJSON: () => ({}) },
      storageClass: 'Standard',
      body,
      bodyUsed: false,
      arrayBuffer: async () => record.data.slice().buffer,
      bytes: async () => record.data.slice(),
      text: async () => new TextDecoder().decode(record.data),
      json: async () => JSON.parse(new TextDecoder().decode(record.data)),
      blob: async () => new Blob([record.data.slice()]),
      writeHttpMetadata: () => {}
    } as unknown as R2ObjectBody
  }

  async delete(keys: string | string[]): Promise<void> {
    const arr = Array.isArray(keys) ? keys : [keys]
    for (const k of arr) {
      this.store.delete(k)
    }
  }
}
