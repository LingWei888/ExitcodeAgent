import { reactive, watch } from 'vue'
import {
  createLocalAccount,
  isVaultUnlocked,
  lockLocalAccount,
  saveVaultData,
  unlockLocalAccount,
  type VaultData
} from './services/secureStore'
import type { Message, Project, SavedKey, Session, ToolCall } from './types'

export const store = reactive({
  unlocked: false,
  user: null as { name: string; email: string; createdAt: string } | null,
  projects: [] as Project[],
  sessions: {} as Record<string, Session>,
  savedKeys: [] as SavedKey[],
  currentProjectId: '',
  currentSessionId: '',
  currentModelId: '',
  showSettings: false,
  showProjectForm: false,
  mobileSidebarOpen: false,
  mobileDrawerOpen: false
})

let saveTimer: number | undefined

function collectVaultData(): VaultData {
  return {
    user: store.user ?? { name: '', email: '', createdAt: new Date().toISOString() },
    projects: store.projects,
    sessions: store.sessions,
    savedKeys: store.savedKeys,
    currentProjectId: store.currentProjectId,
    currentSessionId: store.currentSessionId,
    currentModelId: store.currentModelId
  }
}

function scheduleVaultSave(): void {
  if (!store.unlocked || !isVaultUnlocked()) return
  if (saveTimer) window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    void saveVaultData(collectVaultData()).catch(() => {
      // A failed write keeps the in-memory state; the user can retry on next change.
    })
  }, 220)
}

watch(
  () => ({
    projects: store.projects,
    sessions: store.sessions,
    savedKeys: store.savedKeys,
    currentProjectId: store.currentProjectId,
    currentSessionId: store.currentSessionId,
    currentModelId: store.currentModelId
  }),
  () => scheduleVaultSave(),
  { deep: true }
)

export function applyVaultData(data: VaultData): void {
  store.user = data.user
  store.projects = data.projects
  store.sessions = data.sessions
  store.savedKeys = data.savedKeys
  store.currentProjectId = data.currentProjectId
  store.currentSessionId = data.currentSessionId
  store.currentModelId = data.currentModelId
  store.unlocked = true
}

export async function setupAccount(name: string, password: string): Promise<void> {
  const data: VaultData = {
    user: { name: name.trim(), email: '', createdAt: new Date().toISOString() },
    projects: [],
    sessions: {},
    savedKeys: [],
    currentProjectId: '',
    currentSessionId: '',
    currentModelId: ''
  }
  await createLocalAccount(data, password)
  applyVaultData(data)
}

export async function unlockAccount(password: string): Promise<void> {
  const data = await unlockLocalAccount(password)
  applyVaultData(data)
}

export function lockAccount(): void {
  lockLocalAccount()
  store.unlocked = false
  store.user = null
  store.projects = []
  store.sessions = {}
  store.savedKeys = []
  store.currentProjectId = ''
  store.currentSessionId = ''
  store.currentModelId = ''
}

export function currentProject(): Project | null {
  return store.projects.find((project) => project.id === store.currentProjectId) ?? null
}

export function currentSession(): Session | null {
  return store.sessions[store.currentSessionId] ?? null
}

export function currentConnection(): SavedKey | undefined {
  return store.savedKeys.find((key) => key.id === store.currentModelId)
}

export function createProject(name: string, description: string, directoryName?: string): Project {
  const project: Project = {
    id: `p-${Date.now()}`,
    name: name.trim(),
    description: description.trim(),
    sessionIds: [],
    ...(directoryName ? { directoryName, directoryPickedAt: new Date().toISOString() } : {})
  }
  store.projects.unshift(project)
  store.currentProjectId = project.id
  store.currentSessionId = ''
  return project
}

export function appendUserMessage(text: string): Message {
  const session = currentSession()
  if (!session) throw new Error('当前没有可用会话。')
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
  if (!session) throw new Error('当前没有可用会话。')
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
  const project = currentProject()
  if (!project) throw new Error('请先创建项目。')
  const now = new Date()
  const id = `s-${Date.now()}`
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