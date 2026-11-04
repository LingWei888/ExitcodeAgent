import { apiRequest, getSessionToken, setSessionToken } from './api'
import type { Project, SavedKey, Session } from '../types'

export interface VaultData {
  user: { name: string; email: string; createdAt: string }
  projects: Project[]
  sessions: Record<string, Session>
  savedKeys: SavedKey[]
  currentProjectId: string
  currentSessionId: string
  currentModelId: string
}

interface SessionResponse {
  token: string
  data: VaultData
}

export async function hasLocalAccount(): Promise<boolean> {
  const state = await apiRequest<{ hasAccount: boolean }>('/api/state')
  return state.hasAccount
}

export async function createLocalAccount(data: VaultData, password: string): Promise<void> {
  const response = await apiRequest<SessionResponse>('/api/setup', {
    method: 'POST',
    body: { name: data.user.name, password }
  })
  setSessionToken(response.token)
}

export async function unlockLocalAccount(password: string): Promise<VaultData> {
  const response = await apiRequest<SessionResponse>('/api/unlock', {
    method: 'POST',
    body: { password }
  })
  setSessionToken(response.token)
  return response.data
}

export async function saveVaultData(data: VaultData): Promise<void> {
  await apiRequest<{ ok: boolean }>('/api/vault', {
    method: 'PUT',
    body: data
  })
}

export function isVaultUnlocked(): boolean {
  return Boolean(getSessionToken())
}

export function lockLocalAccount(): void {
  const token = getSessionToken()
  setSessionToken(null)
  if (token) {
    void apiRequest('/api/lock', { method: 'POST' }).catch(() => {
      // The local session is cleared even if the server is unreachable.
    })
  }
}
