let sessionToken = ''

export function setSessionToken(token: string | null): void {
  sessionToken = token ?? ''
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
