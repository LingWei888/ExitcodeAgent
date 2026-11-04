export type ToolKind =
  | 'read_file'
  | 'write_file'
  | 'list_files'
  | 'grep'
  | 'execute_command'
  | 'git_status'
  | 'git_commit'
  | 'web_fetch'

export type ToolState = 'pending' | 'running' | 'done'

export interface ToolCall {
  id: string
  kind: ToolKind
  title: string
  command?: string
  detail?: string
  output?: string
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
