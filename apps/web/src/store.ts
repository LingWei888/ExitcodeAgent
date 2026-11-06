import { reactive, watch } from 'vue'
import { clearSessionChat, deleteSessionSnapshots } from './services/api'
import {
  createLocalAccount,
  isVaultUnlocked,
  lockLocalAccount,
  saveVaultData,
  unlockLocalAccount,
  type VaultData
} from './services/secureStore'
import type { FileChange, Message, Project, SavedKey, Session, ToolCall } from './types'

export const store = reactive({
  unlocked: false,
  user: null as { name: string; email: string; createdAt: string } | null,
  projects: [] as Project[],
  sessions: {} as Record<string, Session>,
  savedKeys: [] as SavedKey[],
  currentProjectId: '',
  currentSessionId: '',
  currentModelId: '',
  streaming: false,
  showSettings: false,
  showProjectForm: false,
  mobileSidebarOpen: false,
  mobileDrawerOpen: false
})

// 当前 Agent 运行状态（内存态，不落盘），供虚拟宠物与状态栏实时读取
export const agentStatus = reactive({
  running: false,
  phase: '' as 'planning' | 'executing' | 'verifying' | 'compacting' | 'fixing' | 'done' | '',
  stepIndex: 0,
  stepTotal: 0,
  currentToolTitle: '',
  approvalPending: false
})

export function resetAgentStatus(): void {
  agentStatus.running = false
  agentStatus.phase = ''
  agentStatus.stepIndex = 0
  agentStatus.stepTotal = 0
  agentStatus.currentToolTitle = ''
  agentStatus.approvalPending = false
}

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
  if (store.streaming) return
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

export async function unlockAccount(password: string, captcha?: string, captchaId?: string): Promise<void> {
  const data = await unlockLocalAccount(password, captcha, captchaId)
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
    status: 'streaming',
    blocks: []
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

export function deleteProject(id: string): void {
  const project = store.projects.find((p) => p.id === id)
  if (!project) return
  for (const sessionId of project.sessionIds) {
    delete store.sessions[sessionId]
    void deleteSessionSnapshots(sessionId).catch(() => {
      // 快照清理失败不影响记录删除
    })
  }
  store.projects = store.projects.filter((p) => p.id !== id)
  if (store.currentProjectId === id) {
    store.currentProjectId = ''
    store.currentSessionId = ''
  }
}

export function deleteSession(id: string): void {
  const project = store.projects.find((p) => p.sessionIds.includes(id))
  if (!project) return
  project.sessionIds = project.sessionIds.filter((sid) => sid !== id)
  delete store.sessions[id]
  void deleteSessionSnapshots(id).catch(() => {
    // 快照清理失败不影响记录删除
  })
  if (store.currentSessionId === id) {
    store.currentSessionId = ''
  }
}

// 由剩余消息的 write_file / edit_file 工具调用重建文件变更清单（最新在前）
export function filesChangedFromMessages(messages: Message[]): FileChange[] {
  const list: FileChange[] = []
  const seen = new Set<string>()
  for (let i = messages.length - 1; i >= 0; i--) {
    for (const tool of messages[i].tools ?? []) {
      if ((tool.kind !== 'write_file' && tool.kind !== 'edit_file') || !tool.path || seen.has(tool.path)) continue
      seen.add(tool.path)
      list.push({
        path: tool.path,
        kind: tool.changeKind === 'created' ? 'created' : 'modified',
        summary: tool.detail || tool.output?.split('\n')[0] || '已更新'
      })
    }
  }
  return list
}

// git 式按轮撤销：从指定消息起（含该消息）之后全部移除并暂存，可一键还原
export function undoSessionAt(session: Session, messageId: string): void {
  const index = session.messages.findIndex((m) => m.id === messageId)
  if (index < 0) return
  const removed = session.messages.splice(index)
  if (!removed.length) return
  session.truncatedTail = { keptUpTo: removed[0].id, removed, at: new Date().toISOString() }
  session.filesChanged = filesChangedFromMessages(session.messages)
}

// 清空聊天记录：只清消息与文件变更清单，保留当前文件；版本历史由服务端重置回主分支。
// 清空是破坏性操作，不可再通过"还原撤销"找回。
export function clearChat(session: Session): void {
  session.messages = []
  session.filesChanged = []
  session.truncatedTail = undefined
  const now = new Date()
  session.updatedAt = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
  void clearSessionChat(session.id).catch(() => {
    // 服务端历史清理失败不影响记录清空
  })
}

export function restoreSessionUndo(session: Session): void {
  if (!session.truncatedTail) return
  session.messages.push(...session.truncatedTail.removed)
  session.truncatedTail = undefined
  session.filesChanged = filesChangedFromMessages(session.messages)
}

export function dismissSessionUndo(session: Session): void {
  session.truncatedTail = undefined
}
