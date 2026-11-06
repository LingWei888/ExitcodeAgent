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

// 登录页初始化用：是否已有账号 + 当前 IP 是否需要输入图形验证码
export async function fetchServerState(): Promise<{ hasAccount: boolean; captchaRequired: boolean }> {
  const state = await apiRequest<{ hasAccount: boolean; captchaRequired?: boolean }>('/api/state')
  return { hasAccount: state.hasAccount, captchaRequired: Boolean(state.captchaRequired) }
}

export async function createLocalAccount(data: VaultData, password: string): Promise<void> {
  const response = await apiRequest<SessionResponse>('/api/setup', {
    method: 'POST',
    body: { name: data.user.name, password }
  })
  setSessionToken(response.token)
}

export async function unlockLocalAccount(
  password: string,
  captcha?: string,
  captchaId?: string
): Promise<VaultData> {
  const response = await apiRequest<SessionResponse>('/api/unlock', {
    method: 'POST',
    body: { password, ...(captcha && captchaId ? { captcha, captchaId } : {}) }
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

// 用 sessionStorage 里的令牌静默恢复会话（同一标签页刷新不锁定；新标签页无令牌需重新解锁）
export async function restoreVaultSession(): Promise<VaultData | null> {
  if (!getSessionToken()) return null
  try {
    const { data } = await apiRequest<{ data: VaultData }>('/api/vault')
    return data
  } catch {
    setSessionToken(null)
    return null
  }
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
