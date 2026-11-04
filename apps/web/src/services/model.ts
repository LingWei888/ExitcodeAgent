import type { Message, SavedKey } from '../types'
import { getSessionToken } from './api'

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
    return '网络请求失败：请确认 ExitcodeAgent 服务端已经启动。'
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
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const token = getSessionToken()
  if (token) headers.authorization = `Bearer ${token}`
  const response = await fetch('/api/model/stream', {
    method: 'POST',
    headers,
    body: JSON.stringify({ connection, turns }),
    signal
  })

  if (!response.ok) {
    const detail = await readError(response)
    if (response.status === 401) {
      throw new Error('账号已锁定，请重新解锁。')
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
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    const token = getSessionToken()
    if (token) headers.authorization = `Bearer ${token}`
    const response = await fetch('/api/model/test', {
      method: 'POST',
      headers,
      body: JSON.stringify({ connection }),
      signal
    })
    const latencyMs = Math.round(performance.now() - started)
    if (response.ok) {
      return { ok: true, message: '连接成功，密钥可用。', latencyMs }
    }
    const detail = await readError(response)
    if (response.status === 401) {
      return { ok: false, message: '账号已锁定，请重新解锁。', latencyMs }
    }
    return { ok: false, message: detail, latencyMs }
  } catch (error) {
    const latencyMs = Math.round(performance.now() - started)
    return { ok: false, message: toFriendlyError(error), latencyMs }
  }
}

export interface ModelOption {
  id: string
  name?: string
}

export interface ModelListResult {
  ok: boolean
  message: string
  models: ModelOption[]
  latencyMs: number
}

export async function listModels(connection: SavedKey): Promise<ModelListResult> {
  const started = performance.now()
  const signal = new AbortController().signal
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    const token = getSessionToken()
    if (token) headers.authorization = `Bearer ${token}`
    const response = await fetch('/api/models/list', {
      method: 'POST',
      headers,
      body: JSON.stringify({ connection }),
      signal
    })
    const latencyMs = Math.round(performance.now() - started)
    if (response.status === 401) {
      return { ok: false, message: '账号已锁定，请重新解锁。', models: [], latencyMs }
    }
    if (!response.ok) {
      return { ok: false, message: await readError(response), models: [], latencyMs }
    }
    const payload = (await response.json()) as Partial<ModelListResult>
    return {
      ok: payload.ok ?? false,
      message: payload.message ?? '获取模型列表失败。',
      models: payload.models ?? [],
      latencyMs: payload.latencyMs ?? latencyMs
    }
  } catch (error) {
    return { ok: false, message: toFriendlyError(error), models: [], latencyMs: Math.round(performance.now() - started) }
  }
}
