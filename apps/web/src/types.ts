export type ToolKind =
  | 'read_file'
  | 'write_file'
  | 'edit_file'
  | 'list_files'
  | 'glob'
  | 'grep'
  | 'web_fetch'
  | 'web_search'
  | 'git_status'
  | 'git_commit'
  | 'execute_command'
  | 'delegate_task'

export type ToolState = 'pending' | 'running' | 'waiting' | 'done'

export type PlanItemStatus = 'pending' | 'running' | 'done' | 'failed'

export interface PlanItem {
  id: string
  title: string
  status: PlanItemStatus
}

export interface ToolCall {
  id: string
  kind: ToolKind
  title: string
  command?: string
  detail?: string
  output?: string
  failed?: boolean
  progressChars?: number
  diff?: string
  path?: string
  changeKind?: 'created' | 'modified' | 'deleted'
  state: ToolState
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  time: string
  thinking?: string
  tools: ToolCall[]
  status: 'pending' | 'streaming' | 'done' | 'error'
  step?: { index: number; total?: number }
  plan?: PlanItem[]
  stepsUsed?: number
  warnings?: string[]
  blocks?: Array<{ type: 'text'; text: string } | { type: 'tool'; id: string }>
}

export interface FileChange {
  path: string
  kind: 'modified' | 'created' | 'deleted'
  summary: string
}

export interface Session {
  id: string
  title: string
  updatedAt: string
  branch: string
  messages: Message[]
  runTokens: { input: number; output: number }
  filesChanged: FileChange[]
  truncatedTail?: {
    keptUpTo: string
    removed: Message[]
    at: string
    filesRestored?: number
    filesFailed?: boolean
    tipRound?: number
  }
}

export interface Project {
  id: string
  name: string
  description: string
  sessionIds: string[]
  directoryName?: string
  directoryPickedAt?: string
}

export type ProviderId = 'anthropic' | 'openai-compatible' | 'ollama'

export interface ModelPreset {
  id: string
  provider: ProviderId
  label: string
  model: string
}

export interface SavedKey {
  id: string
  provider: ProviderId
  label: string
  baseUrl: string
  model: string
  apiKey: string
}
