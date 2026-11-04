import { getSessionToken } from './api'
import { sseData } from './model'
import type { SavedKey, ToolCall } from '../types'

export interface AgentTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface AgentEvent {
  type: 'step' | 'tool' | 'tool_result' | 'text' | 'usage' | 'error'
  index?: number
  text?: string
  tool?: ToolCall
  input?: number
  output?: number
  message?: string
}

export async function* runAgent(
  connection: SavedKey,
  turns: AgentTurn[],
  workspace: string,
  signal: AbortSignal
): AsyncGenerator<AgentEvent> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const token = getSessionToken()
  if (token) headers.authorization = `Bearer ${token}`

  const response = await fetch('/api/agent/run', {
    method: 'POST',
    headers,
    body: JSON.stringify({ connection, turns, workspace }),
    signal
  })

  if (!response.ok || !response.body) {
    let message = `请求失败（HTTP ${response.status}）`
    try {
      const body = await response.json()
      if (body?.error) message = String(body.error)
    } catch {
      // keep the generic message
    }
    if (response.status === 401) message = '账号已锁定，请重新解锁。'
    throw new Error(message)
  }

  for await (const raw of sseData(response)) {
    if (raw.type === 'tool' || raw.type === 'tool_result') {
      yield { type: raw.type, tool: raw.tool as ToolCall } as AgentEvent
    } else {
      yield raw as unknown as AgentEvent
    }
  }
}
