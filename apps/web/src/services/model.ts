import type { Message, SavedKey } from '../types'

export interface ModelTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface StreamEvent {
  text: string
  usage?: { input: number; output: number }
}

const MODEL_URLS: Record<string, string> = {
  anthropic: 'https://api.anthropic.com',
  'openai-compatible': 'https://api.deepseek.com/v1',
  ollama: 'http://localhost:11434/v1'
}

export function providerDefaultUrl(provider: string): string {
  return MODEL_URLS[provider] ?? ''
}

export function sessionToTurns(messages: Message[]): ModelTurn[] {
  return messages
    .filter((message) => message.role === 'user' || (message.role === 'assistant' && message.content.trim()))
    .map((message) => ({ role: message.role, content: message.content }))
}

function stripSlash(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

function anthropicUrl(baseUrl: string): string {
  const base = stripSlash(baseUrl)
  return base.endsWith('/v1') ? `${base}/messages` : `${base}/v1/messages`
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json()
    if (body?.error?.message) return body.error.message
    if (body?.message) return body.message
  } catch {
    // fall through to generic message
  }
  return `请求失败（HTTP ${response.status}）`
}

export function toFriendlyError(error: unknown): string {
  if (error instanceof TypeError) {
    return '网络请求失败：接口地址可能不可达，或目标服务没有允许浏览器跨域访问（CORS）。'
  }
  if (error instanceof Error && error.message) return error.message
  return '请求失败，请检查模型设置。'
}

async function* sseData(response: Response): AsyncGenerator<Record<string, unknown>> {
  if (!response.body) return
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        yield JSON.parse(payload) as Record<string, unknown>
      } catch {
        // skip malformed keep-alive events
      }
    }
  }
}

export async function* streamModel(
  connection: SavedKey,
  turns: ModelTurn[],
  signal: AbortSignal
): AsyncGenerator<StreamEvent> {
  const baseUrl = connection.baseUrl.trim() || providerDefaultUrl(connection.provider)
  const headers: Record<string, string> = {
    'content-type': 'application/json'
  }
  let url = ''
  let body: Record<string, unknown>

  if (connection.provider === 'anthropic') {
    url = anthropicUrl(baseUrl)
    headers['x-api-key'] = connection.apiKey
    headers['anthropic-version'] = '2023-06-01'
    headers['anthropic-dangerous-direct-browser-access'] = 'true'
    body = {
      model: connection.model,
      max_tokens: 2048,
      stream: true,
      messages: turns.map((turn) => ({ role: turn.role, content: turn.content }))
    }
  } else {
    url = `${stripSlash(baseUrl)}/chat/completions`
    headers.authorization = `Bearer ${connection.apiKey}`
    body = {
      model: connection.model,
      stream: true,
      messages: turns.map((turn) => ({ role: turn.role, content: turn.content }))
    }
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal
  })

  if (!response.ok) {
    const detail = await readError(response)
    if (response.status === 401 || response.status === 403) {
      throw new Error('认证失败：请检查 API Key 是否正确、是否有该模型的访问权限。')
    }
    throw new Error(detail)
  }

  let inputTokens = 0
  let outputTokens = 0

  for await (const event of sseData(response)) {
    if (connection.provider === 'anthropic') {
      if (event.type === 'message_start') {
        const usage = (event.message as { usage?: { input_tokens?: number } } | undefined)?.usage
        inputTokens = usage?.input_tokens ?? 0
      }
      if (event.type === 'message_delta') {
        const usage = (event as { usage?: { output_tokens?: number } }).usage
        outputTokens = usage?.output_tokens ?? 0
      }
      if (event.type === 'content_block_delta') {
        const delta = event.delta as { type?: string; text?: string }
        if (delta?.type === 'text_delta' && delta.text) {
          yield { text: delta.text }
        }
      }
    } else {
      const choice = (event.choices as Array<{ delta?: { content?: string } }> | undefined)?.[0]
      const text = choice?.delta?.content ?? ''
      if (text) yield { text }
      const usage = event.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined
      if (usage) {
        inputTokens = usage.prompt_tokens ?? inputTokens
        outputTokens = usage.completion_tokens ?? outputTokens
      }
    }
  }

  yield { text: '', usage: { input: inputTokens, output: outputTokens } }
}

export interface ConnectionTest {
  ok: boolean
  message: string
  latencyMs: number
}

export async function testConnection(connection: SavedKey): Promise<ConnectionTest> {
  const started = performance.now()
  const signal = new AbortController().signal
  const baseUrl = connection.baseUrl.trim() || providerDefaultUrl(connection.provider)
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  let url = ''
  let body: Record<string, unknown>

  if (connection.provider === 'anthropic') {
    url = anthropicUrl(baseUrl)
    headers['x-api-key'] = connection.apiKey
    headers['anthropic-version'] = '2023-06-01'
    headers['anthropic-dangerous-direct-browser-access'] = 'true'
    body = { model: connection.model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }
  } else {
    url = `${stripSlash(baseUrl)}/chat/completions`
    headers.authorization = `Bearer ${connection.apiKey}`
    body = { model: connection.model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }
  }

  try {
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal })
    const latencyMs = Math.round(performance.now() - started)
    if (response.ok) {
      return { ok: true, message: '连接成功，密钥可用。', latencyMs }
    }
    const detail = await readError(response)
    if (response.status === 401 || response.status === 403) {
      return { ok: false, message: '认证失败：请检查 API Key。', latencyMs }
    }
    return { ok: false, message: detail, latencyMs }
  } catch (error) {
    const latencyMs = Math.round(performance.now() - started)
    return { ok: false, message: toFriendlyError(error), latencyMs }
  }
}