import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  hasAccount,
  lockSession,
  saveSessionData,
  setupAccount,
  touchSession,
  unlockedCount,
  unlockAccount
} from './vault.mjs'
import { listServerDirectory } from './files.mjs'
import { listModels, streamModelToClient, testModel } from './model.mjs'
import { runAgentSteps } from './agent.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const WEB_DIST = resolve(here, '..', '..', 'web', 'dist')
const PORT = Number(process.env.PORT || 8787)
const HOST = process.env.HOST || '0.0.0.0'

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  })
  res.end(payload)
}

async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 10 * 1024 * 1024) throw new Error('请求体过大。')
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw.trim()) return {}
  return JSON.parse(raw)
}

function bearerToken(req) {
  const header = req.headers.authorization || ''
  return header.startsWith('Bearer ') ? header.slice(7) : ''
}

function requireSession(req, res) {
  const token = bearerToken(req)
  const session = token ? touchSession(token) : null
  if (!session) {
    sendJson(res, 401, { error: '账号已锁定，请重新解锁。' })
    return null
  }
  return { token, session }
}

function defaultVaultData(name) {
  const now = new Date().toISOString()
  return {
    user: { name: name.trim(), email: '', createdAt: now },
    projects: [],
    sessions: {},
    savedKeys: [],
    currentProjectId: '',
    currentSessionId: '',
    currentModelId: ''
  }
}

async function routeApi(req, res, pathname) {
  const isGet = req.method === 'GET'
  const isPost = req.method === 'POST'
  const isPut = req.method === 'PUT'

  if (isGet && pathname === '/api/state') {
    sendJson(res, 200, { hasAccount: hasAccount(), unlocked: unlockedCount() > 0 })
    return
  }

  if (isPost && pathname === '/api/setup') {
    if (hasAccount()) {
      sendJson(res, 409, { error: '服务器已经创建过账号。' })
      return
    }
    const body = await readJson(req)
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    if (!name) throw new Error('请填写账号名称。')
    if (password.length < 8) throw new Error('口令至少 8 位。')
    const result = await setupAccount(defaultVaultData(name), password)
    sendJson(res, 200, result)
    return
  }

  if (isPost && pathname === '/api/unlock') {
    const body = await readJson(req)
    const result = await unlockAccount(String(body.password || ''))
    sendJson(res, 200, result)
    return
  }

  if (isPost && pathname === '/api/lock') {
    const token = bearerToken(req)
    if (token) lockSession(token)
    sendJson(res, 200, { ok: true })
    return
  }

  const auth = isGet || isPost || isPut ? requireSession(req, res) : null
  if (!auth) return

  if (isGet && pathname === '/api/vault') {
    sendJson(res, 200, { data: auth.session.data })
    return
  }

  if (isPut && pathname === '/api/vault') {
    const body = await readJson(req)
    await saveSessionData(auth.token, body)
    sendJson(res, 200, { ok: true })
    return
  }

  if (isPost && pathname === '/api/workspace/list') {
    const body = await readJson(req)
    const listing = await listServerDirectory(body.path)
    sendJson(res, 200, listing)
    return
  }

  if (isPost && pathname === '/api/model/stream') {
    const body = await readJson(req)
    await streamModelToClient(res, body.connection, body.turns)
    return
  }

  if (isPost && pathname === '/api/model/test') {
    const body = await readJson(req)
    const result = await testModel(body.connection)
    sendJson(res, 200, result)
    return
  }

  if (isPost && pathname === '/api/models/list') {
    const body = await readJson(req)
    const result = await listModels(body.connection)
    sendJson(res, 200, result)
    return
  }

  if (isPost && pathname === '/api/agent/run') {
    const body = await readJson(req)
    const workspace = typeof body.workspace === 'string' ? body.workspace.trim() : ''
    const projects = Array.isArray(auth.session.data?.projects) ? auth.session.data.projects : []
    const allowedWorkspace = projects.some((project) => project?.directoryName === workspace)
    if (!Array.isArray(body.turns) || !body.connection || !workspace) {
      throw new Error('工作区和对话参数不完整。')
    }
    if (!allowedWorkspace) {
      throw new Error('工作区不在当前账号的项目目录中。')
    }

    const controller = new AbortController()
    const onClose = () => controller.abort()
    req.on('close', onClose)
    res.on('close', onClose)
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      'x-accel-buffering': 'no',
      connection: 'keep-alive'
    })
    try {
      for await (const event of runAgentSteps({
        connection: body.connection,
        turns: body.turns,
        workspace,
        signal: controller.signal
      })) {
        if (res.destroyed) break
        res.write(`data: ${JSON.stringify(event)}\n\n`)
      }
      if (!res.destroyed) {
        res.write('data: [DONE]\n\n')
        res.end()
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Agent 执行失败。'
      if (!res.destroyed) {
        res.write(`data: ${JSON.stringify({ type: 'error', message })}\n\n`)
        res.write('data: [DONE]\n\n')
        res.end()
      }
    } finally {
      req.removeListener('close', onClose)
      res.removeListener('close', onClose)
    }
    return
  }

  sendJson(res, 404, { error: '接口不存在。' })
}

async function serveStatic(req, res, pathname) {
  if (!existsSync(WEB_DIST)) {
    sendJson(res, 404, { error: '前端还没有构建，请先运行 pnpm build:web。' })
    return
  }

  let clean = decodeURIComponent(pathname || '/')
  if (clean === '/') clean = '/index.html'
  const target = resolve(WEB_DIST, '.' + clean)
  if (target !== WEB_DIST && !target.startsWith(WEB_DIST + sep)) {
    sendJson(res, 403, { error: '路径不合法。' })
    return
  }

  let finalPath = target
  try {
    if (existsSync(finalPath) && existsSync(join(finalPath, 'index.html'))) {
      finalPath = join(finalPath, 'index.html')
    }
    const content = await readFile(finalPath)
    const mime = MIME_TYPES[extname(finalPath).toLowerCase()] || 'application/octet-stream'
    res.writeHead(200, {
      'content-type': mime,
      'cache-control': extname(finalPath) === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable'
    })
    res.end(content)
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      const index = join(WEB_DIST, 'index.html')
      if (existsSync(index)) {
        const content = await readFile(index)
        res.writeHead(200, { 'content-type': MIME_TYPES['.html'], 'cache-control': 'no-cache' })
        res.end(content)
        return
      }
      sendJson(res, 404, { error: '页面不存在。' })
      return
    }
    throw error
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    if (url.pathname.startsWith('/api/')) {
      await routeApi(req, res, url.pathname)
    } else {
      await serveStatic(req, res, url.pathname)
    }
  } catch (error) {
    console.error('[exitcode-api]', error instanceof Error ? error.stack : error)
    if (!res.headersSent) sendJson(res, 500, { error: error instanceof Error ? error.message : '服务器错误。' })
    else res.end()
  }
})

server.listen(PORT, HOST, () => {
  console.log(`ExitcodeAgent server listening on http://${HOST}:${PORT}`)
  console.log(existsSync(WEB_DIST) ? `Serving frontend from ${WEB_DIST}` : 'Frontend dist not built yet.')
})

function shutdown() {
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 3000).unref()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

