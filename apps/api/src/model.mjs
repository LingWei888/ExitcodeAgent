const PROVIDER_URLS = {
  anthropic: 'https://api.anthropic.com',
  'openai-compatible': 'https://api.deepseek.com/v1',
  ollama: 'http://localhost:11434/v1'
}

function stripSlash(url) {
  return String(url || '').trim().replace(/\/+$/, '')
}

function anthropicUrl(baseUrl) {
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

async function upstreamError(response) {
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

function validateConnection(connection) {
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
