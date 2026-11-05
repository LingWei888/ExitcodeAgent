let sessionToken = ''

export function setSessionToken(token: string | null): void {
  sessionToken = token ?? ''
}

export interface FileRestoreEntry {
  path: string
  action: 'write' | 'delete'
}

export interface RestoreResult {
  restored: FileRestoreEntry[]
  tipCommit: string | null
  tipRound: number | null
}

// git 式回滚：把会话关联工作区的文件回滚到“第 boundary 轮完成后”的状态；
// restoreTo=true 时表示把文件恢复到第 boundary 轮的状态（用于撤销之后的“还原（含文件）”）
export async function restoreSessionFiles(
  sessionId: string,
  boundary: number | null,
  restoreTo = false
): Promise<RestoreResult> {
  return apiRequest<RestoreResult>('/api/session/restore', {
    method: 'POST',
    body: { sessionId, boundary, restoreTo }
  })
}

// 分支：以 fromSession 第 boundary 轮完成后的文件状态，作为 toSession（新会话）的快照起点
export async function forkSessionSnapshots(fromSessionId: string, toSessionId: string, boundary: number | null): Promise<void> {
  await apiRequest<{ ok: boolean }>('/api/session/fork', {
    method: 'POST',
    body: { fromSessionId, toSessionId, boundary }
  })
}

// 新模型：从主分支当前状态分叉，全新空会话
export async function forkSessionFromMain(toSessionId: string, workspace: string): Promise<void> {
  await apiRequest<{ ok: boolean }>('/api/session/fork', {
    method: 'POST',
    body: { toSessionId, fromMain: true, workspace }
  })
}

export interface MergeResult {
  ok?: boolean
  code?: string
  merged?: 'already' | 'file'
  fastForward?: boolean
  mergedSha?: string | null
  conflicts?: string[]
  error?: string
}

export async function mergeSessionToMain(sessionId: string): Promise<MergeResult> {
  return apiRequest<MergeResult>('/api/session/merge', {
    method: 'POST',
    body: { sessionId }
  })
}

export async function clearSessionChat(sessionId: string): Promise<void> {
  await apiRequest<{ ok: boolean }>('/api/session/clear', {
    method: 'POST',
    body: { sessionId }
  })
}

export async function deleteSessionSnapshots(sessionId: string): Promise<void> {
  await apiRequest<{ ok: boolean }>('/api/session/delete-snapshots', {
    method: 'POST',
    body: { sessionId }
  })
}

export interface GraphFile {
  path: string
  status: string
  add: number | null
  del: number | null
}

export interface GraphCommit {
  sha: string
  seq: number
  session: string
  round: number | null
  merge?: boolean
  mergedSession?: string
  files: GraphFile[]
}

export interface GraphMain {
  tipCommit: string | null
  commits: GraphCommit[]
}

export interface GraphBranch {
  sessionId: string
  name?: string
  forkFrom?: string | null
  forkRound?: number | null
  forkCommit?: string | null
  mergedIntoMain?: boolean
  commits: GraphCommit[]
}

export async function fetchSessionGraph(workspace: string): Promise<{ main?: GraphMain | null; branches: GraphBranch[] }> {
  return apiRequest<{ main?: GraphMain | null; branches: GraphBranch[] }>('/api/session/graph', {
    method: 'POST',
    body: { workspace }
  })
}

export async function fetchRoundDiff(workspace: string, sha: string): Promise<string> {
  const result = await apiRequest<{ patch: string }>('/api/session/round-diff', {
    method: 'POST',
    body: { workspace, sha }
  })
  return result?.patch ?? ''
}

export function getSessionToken(): string {
  return sessionToken
}

export async function apiRequest<T>(
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<T> {
  const headers: Record<string, string> = {}
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  if (sessionToken) headers.authorization = `Bearer ${sessionToken}`

  const response = await fetch(path, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  })

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    // non-JSON responses keep the generic error text
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : `请求失败（HTTP ${response.status}）`
    throw new Error(message)
  }

  return payload as T
}
