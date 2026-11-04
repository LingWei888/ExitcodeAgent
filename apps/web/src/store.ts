import { reactive } from 'vue'
import { demoProjects, demoSessions, modelPresets, savedKeys as seedKeys } from './mock/data'
import type { Message, Project, Session, ToolCall } from './types'

const savedUser = localStorage.getItem('exitcode.demo.user')

export const store = reactive({
  authed: Boolean(savedUser),
  user: savedUser ? JSON.parse(savedUser) as { name: string; email: string } : null,
  projects: demoProjects,
  sessions: demoSessions,
  currentProjectId: 'p-exit',
  currentSessionId: 's-1',
  currentModelId: 'm-claude',
  models: [...modelPresets],
  savedKeys: [...seedKeys],
  showSettings: false,
  mobileSidebarOpen: false,
  mobileDrawerOpen: false,
  activeConnection: 'demo'
})

export function currentProject(): Project {
  return store.projects.find((p) => p.id === store.currentProjectId) ?? store.projects[0]
}

export function currentSession(): Session {
  return store.sessions[store.currentSessionId]
}

export function login(name: string, email: string): void {
  const user = { name, email }
  localStorage.setItem('exitcode.demo.user', JSON.stringify(user))
  store.user = user
  store.authed = true
}

export function logout(): void {
  localStorage.removeItem('exitcode.demo.user')
  store.authed = false
  store.user = null
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
  return message
}

export function createAssistantMessage(thinking: string, tools: ToolCall[]): Message {
  const session = currentSession()
  const now = new Date()
  const message: Message = {
    id: `am-${Date.now()}`,
    role: 'assistant',
    content: '',
    time: `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`,
    thinking,
    tools,
    status: 'streaming'
  }
  session.messages.push(message)
  session.updatedAt = message.time
  return message
}

export function createSession(title: string): Session {
  const now = new Date()
  const id = `s-${Date.now()}`
  const project = currentProject()
  const session: Session = {
    id,
    title,
    updatedAt: `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`,
    branch: 'feat/web-prototype',
    messages: [],
    runTokens: { input: 0, output: 0 },
    filesChanged: []
  }
  store.sessions[id] = session
  project.sessionIds.unshift(id)
  store.currentSessionId = id
  return session
}
