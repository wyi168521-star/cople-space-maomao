/** 增量解析 SSE，兼容 UTF-8 / JSON 被拆包、CRLF、多行 data 和心跳注释。 */
export async function* readSseData(stream: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let data: string[] = []
  const abort = () => { void reader.cancel().catch(() => {}) }
  signal?.addEventListener('abort', abort, { once: true })
  try {
    if (signal?.aborted) throw new Error('Stream aborted')
    while (true) {
      const chunk = await reader.read()
      if (signal?.aborted) throw new Error('Stream aborted')
      buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true })
      // 以空行结尾才分发事件，残缺的最后一帧交给调用方视为中断。
      let end: number
      while ((end = buffer.indexOf('\n')) !== -1) {
        let line = buffer.slice(0, end)
        buffer = buffer.slice(end + 1)
        if (line.endsWith('\r')) line = line.slice(0, -1)
        if (!line) {
          if (data.length) { const frame = data.join('\n'); data = []; yield frame }
        } else if (line.startsWith('data:')) {
          data.push(line.slice(5).replace(/^ /, ''))
        }
        if (buffer.length + data.join('\n').length > 65536) throw new Error('SSE frame too large')
      }
      if (buffer.length + data.join('\n').length > 65536) throw new Error('SSE frame too large')
      if (chunk.done) break
    }
  } finally {
    signal?.removeEventListener('abort', abort)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
