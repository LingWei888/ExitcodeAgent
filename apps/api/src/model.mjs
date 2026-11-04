const PROVIDER_URLS = {
  anthropic: 'https://api.anthropic.com',
  'openai-compatible': 'https://api.deepseek.com/v1',
  ollama: 'http://localhost:11434/v1'
}

export function stripSlash(url) {
  return String(url || '').trim().replace(/\/+$/, '')
}

export function anthropicUrl(baseUrl) {
  const base = stripSlash(baseUrl)
  return base.endsWith('/v1') ? `${base}/messages` : `${base}/v1/messages`
}

function buildUpstreamRequest(connection, turns, test = false) {
  const baseUrl = stripSlash(connection?.baseUrl) || PROVIDER_URLS[connection?.provider] || ''
  const headers = { 'content-type': 'application/json' }
  let url = ''
  let body = {}

  if (connection.provider === 'anthropic') {
    url = anthropicUrl(baseUrl)
    headers['x-api-key'] = connection.apiKey
    headers['anthropic-version'] = '2023-06-01'
    body = {
      model: connection.model,
      max_tokens: test ? 1 : 2048,
      stream: !test,
      messages: turns.map((turn) => ({ role: turn.role, content: turn.content }))
    }
  } else {
    url = `${baseUrl}/chat/completions`
    headers.authorization = `Bearer ${connection.apiKey}`
    body = {
      model: connection.model,
      max_tokens: test ? 1 : 2048,
      stream: !test,
      messages: turns.map((turn) => ({ role: turn.role, content: turn.content }))
    }
  }

  return { url, headers, body }
}

export async function upstreamError(response) {
  let detail = `模型服务请求失败（HTTP ${response.status}）`
  try {
    const body = await response.json()
    if (body?.error?.message) detail = body.error.message
    else if (body?.message) detail = body.message
  } catch {
    // keep the generic message
  }
  return detail
}

export function validateConnection(connection) {
  return connection && typeof connection === 'object' && ['anthropic', 'openai-compatible', 'ollama'].includes(connection.provider) && connection.apiKey && connection.model
}

export async function streamModelToClient(clientResponse, connection, turns) {
  if (!validateConnection(connection) || !Array.isArray(turns)) {
    clientResponse.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
    clientResponse.end(JSON.stringify({ error: '模型接入参数不完整。' }))
    return
  }

  const controller = new AbortController()
  const onClose = () => controller.abort()
  clientResponse.on('close', onClose)

  const { url, headers, body } = buildUpstreamRequest(connection, turns, false)
  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    })

    if (!upstream.ok || !upstream.body) {
      const detail = await upstreamError(upstream)
      clientResponse.writeHead(upstream.status || 502, { 'content-type': 'application/json; charset=utf-8' })
      clientResponse.end(JSON.stringify({ error: detail }))
      return
    }

    clientResponse.writeHead(200, {
      'content-type': upstream.headers.get('content-type') || 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      'x-accel-buffering': 'no',
      connection: 'keep-alive'
    })

    for await (const chunk of upstream.body) {
      if (clientResponse.destroyed) break
      clientResponse.write(chunk)
    }
    clientResponse.end()
  } catch (error) {
    if (clientResponse.destroyed) return
    if (!clientResponse.headersSent) {
      clientResponse.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
      clientResponse.end(JSON.stringify({ error: error instanceof Error ? error.message : '模型转发失败。' }))
    } else {
      clientResponse.end()
    }
  } finally {
    clientResponse.removeListener('close', onClose)
  }
}

export async function testModel(connection) {
  const started = Date.now()
  if (!validateConnection(connection)) {
    return { ok: false, message: '模型接入参数不完整。', latencyMs: Date.now() - started }
  }
  const { url, headers, body } = buildUpstreamRequest(connection, [{ role: 'user', content: 'ping' }], true)
  try {
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
    const latencyMs = Date.now() - started
    if (response.ok) return { ok: true, message: '连接成功，密钥可用。', latencyMs }
    const detail = await upstreamError(response)
    if (response.status === 401 || response.status === 403) {
      return { ok: false, message: '认证失败：请检查 API Key。', latencyMs }
    }
    return { ok: false, message: detail, latencyMs }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '模型服务不可达。', latencyMs: Date.now() - started }
  }
}

function parseModelList(json) {
  const candidates = Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : []
  const seen = new Set()
  const models = []
  for (const item of candidates) {
    const id = item?.id || item?.model || item?.name
    if (!id) continue
    const key = String(id)
    if (seen.has(key)) continue
    seen.add(key)
    models.push({ id: key, name: item?.name || key })
  }
  return models
}

export async function listModels(connection) {
  const started = Date.now()
  const fail = (message) => ({ ok: false, message, models: [], latencyMs: Date.now() - started })

  if (!connection || typeof connection !== 'object' || !['anthropic', 'openai-compatible', 'ollama'].includes(connection.provider)) {
    return fail('提供方参数无效。')
  }
  const baseUrl = stripSlash(connection.baseUrl) || PROVIDER_URLS[connection.provider] || ''
  const apiKey = String(connection.apiKey || '')
  if (connection.provider !== 'ollama' && !apiKey) {
    return fail('获取模型列表前需要填写 API Key。')
  }

  const headers = { accept: 'application/json' }
  if (connection.provider === 'anthropic') {
    headers['x-api-key'] = apiKey
    headers['anthropic-version'] = '2023-06-01'
  } else if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`
  }

  const candidates = []
  if (connection.provider === 'anthropic') {
    candidates.push(baseUrl.endsWith('/v1') ? `${baseUrl}/models` : `${baseUrl}/v1/models`)
  } else if (connection.provider === 'ollama' && !baseUrl.endsWith('/v1')) {
    candidates.push(`${baseUrl}/api/tags`, `${baseUrl}/v1/models`)
  } else {
    candidates.push(`${baseUrl}/models`)
  }

  let lastError
  for (const url of candidates) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    try {
      const response = await fetch(url, { method: 'GET', headers, signal: controller.signal })
      if (!response.ok) {
        const detail = await upstreamError(response)
        if ((response.status === 404 || response.status === 405) && url !== candidates[candidates.length - 1]) {
          lastError = new Error(detail)
          continue
        }
        if (response.status === 401 || response.status === 403) {
          return fail('认证失败：接口地址或 API Key 不正确。')
        }
        return fail(detail)
      }
      const json = await response.json()
      const models = parseModelList(json)
      if (!models.length) return fail('接口可用，但没有返回模型列表。')
      return {
        ok: true,
        message: `接口可用，获取到 ${models.length} 个模型。`,
        models,
        latencyMs: Date.now() - started
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('获取模型列表失败。')
      if (lastError.name === 'AbortError') lastError.message = '请求超时：接口地址可能不正确。'
    } finally {
      clearTimeout(timer)
    }
  }

  return fail(lastError?.message || '获取模型列表失败。')
}
