import { reactive, watch } from 'vue'
import { demoProjects, demoSessions } from './mock/data'
import type { Message, Project, SavedKey, Session, ToolCall } from './types'

const STORAGE_KEY = 'exitcode.store.v1'

interface PersistedState {
  user: { name: string; email: string } | null
  authed: boolean
  projects: Project[]
  sessions: Record<string, Session>
  savedKeys: SavedKey[]
  currentProjectId: string
  currentSessionId: string
  currentModelId: string
}

function loadPersisted(): Partial<PersistedState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Partial<PersistedState>
    if (Array.isArray(parsed.savedKeys)) {
      parsed.savedKeys = parsed.savedKeys.map((key) => ({
        id: key.id,
        provider: key.provider,
        label: key.label,
        baseUrl: key.baseUrl,
        model: key.model,
        apiKey: (key as { apiKey?: string }).apiKey ?? ''
      }))
    }
    return parsed
  } catch {
    return {}
  }
}

const persisted = loadPersisted()

export const store = reactive({
  authed: Boolean(localStorage.getItem('exitcode.demo.user')) || Boolean(persisted.authed),
  user: persisted.user ?? null,
  projects: persisted.projects ?? demoProjects,
  sessions: persisted.sessions ?? demoSessions,
  savedKeys: persisted.savedKeys ?? [],
  currentProjectId: persisted.currentProjectId ?? 'p-exit',
  currentSessionId: persisted.currentSessionId ?? 's-1',
  currentModelId: persisted.currentModelId ?? '',
  showSettings: false,
  mobileSidebarOpen: false,
  mobileDrawerOpen: false
})

watch(
  () => ({
    authed: store.authed,
    user: store.user,
    projects: store.projects,
    sessions: store.sessions,
    savedKeys: store.savedKeys,
    currentProjectId: store.currentProjectId,
    currentSessionId: store.currentSessionId,
    currentModelId: store.currentModelId
  }),
  (value) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
    } catch {
      // Storage may be unavailable; the session still works in memory.
    }
  },
  { deep: true }
)

export function currentProject(): Project {
  return store.projects.find((p) => p.id === store.currentProjectId) ?? store.projects[0]
}

export function currentSession(): Session {
  return store.sessions[store.currentSessionId]
}

export function currentConnection(): SavedKey | undefined {
  return store.savedKeys.find((key) => key.id === store.currentModelId)
}

export function login(name: string, email: string): void {
  store.user = { name, email }
  store.authed = true
}

export function logout(): void {
  store.authed = false
  store.user = null
  localStorage.removeItem('exitcode.demo.user')
}

export function appendUserMessage(text: string): Message {
  const session = currentSession()
  const now = new Date()
  const message: Message = {
    id: `um-${Date.now()}`,
    role: 'user',
    content: text,
    time: `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`,
    tools: [],
    status: 'done'
  }
  session.messages.push(message)
  session.updatedAt = message.time
  return session.messages[session.messages.length - 1]
}

export function createAssistantMessage(): Message {
  const session = currentSession()
  const now = new Date()
  const message: Message = {
    id: `am-${Date.now()}`,
    role: 'assistant',
    content: '',
    time: `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`,
    thinking: '',
    tools: [] as ToolCall[],
    status: 'streaming'
  }
  session.messages.push(message)
  session.updatedAt = message.time
  return session.messages[session.messages.length - 1]
}

export function createSession(title: string): Session {
  const now = new Date()
  const id = `s-${Date.now()}`
  const project = currentProject()
  const session: Session = {
    id,
    title,
    updatedAt: `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`,
    branch: 'local',
    messages: [],
    runTokens: { input: 0, output: 0 },
    filesChanged: []
  }
  store.sessions[id] = session
  project.sessionIds.unshift(id)
  store.currentSessionId = id
  return session
}