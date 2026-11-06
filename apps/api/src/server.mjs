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
import { createRevision } from './revision.mjs'
import { isApprovalOwner, resolveApproval } from './approvals.mjs'
import { captchaSvg, createCaptcha, getCaptchaCode, verifyCaptcha } from './captcha.mjs'
import {
  ipBlockWaitMs,
  ipFailures,
  isAccountLocked,
  isIpBlocked,
  recordIpFailure,
  recordTotalFailure
} from './security.mjs'

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

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  return forwarded || (req.socket && req.socket.remoteAddress) || ''
}

// 通过会话 id 找到它所属项目的工作区目录；找不到返回空字符串
function sessionWorkspace(sessionData, sessionId) {
  const project = (sessionData?.projects ?? []).find((p) => (p?.sessionIds ?? []).includes(sessionId))
  return typeof project?.directoryName === 'string' ? project.directoryName.trim() : ''
}

function requireSession(req, res) {
  const token = bearerToken(req)
  const session = token ? touchSession(token) : null
  if (!session) {
    sendJson(res, 401, { error: '登录已过期或已锁定，请重新解锁。' })
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
    sendJson(res, 200, {
      hasAccount: hasAccount(),
      unlocked: unlockedCount() > 0,
      captchaRequired: ipFailures(clientIp(req)) > 0
    })
    return
  }

  if (isGet && pathname === '/api/captcha/new') {
    sendJson(res, 200, { captchaId: createCaptcha() })
    return
  }

  const CAPTCHA_PREFIX = '/api/captcha/'
  if (isGet && pathname.startsWith(CAPTCHA_PREFIX)) {
    const id = pathname.slice(CAPTCHA_PREFIX.length).replace(/[^a-zA-Z0-9-]/g, '')
    const code = getCaptchaCode(id)
    if (!code) {
      sendJson(res, 404, { error: '验证码不存在或已过期，请刷新后重试。' })
      return
    }
    res.writeHead(200, {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'no-store, no-cache, must-revalidate'
    })
    res.end(captchaSvg(code))
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
    const ip = clientIp(req)
    if (isAccountLocked()) {
      sendJson(res, 423, { error: '密码尝试次数过多，账号已锁定，暂时无法登录。' })
      return
    }
    if (isIpBlocked(ip)) {
      const waitMin = Math.max(1, Math.ceil(ipBlockWaitMs(ip) / 60000))
      sendJson(res, 429, { error: `该 IP 尝试次数过多，请 ${waitMin} 分钟后再试。` })
      return
    }
    const body = await readJson(req)
    // 该 IP 在当前周期内有过失败后，才要求图形验证码
    if (ipFailures(ip) > 0 && !verifyCaptcha(body.captchaId, body.captcha)) {
      sendJson(res, 401, { error: '图形验证码错误，请重试。', captchaRequired: true, captchaId: createCaptcha() })
      return
    }
    try {
      const result = await unlockAccount(String(body.password || ''))
      sendJson(res, 200, result)
    } catch (error) {
      recordIpFailure(ip)
      if (recordTotalFailure()) {
        sendJson(res, 423, { error: '密码尝试次数过多，账号已锁定，暂时无法登录。' })
        return
      }
      sendJson(res, 401, { error: '口令不正确，请重试。', captchaRequired: true, captchaId: createCaptcha() })
    }
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

    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    let revision = null
    if (sessionId) {
      if (sessionWorkspace(auth.session.data, sessionId) !== workspace) {
        throw new Error('会话与工作区不匹配。')
      }
      revision = await createRevision(workspace, sessionId)
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
        signal: controller.signal,
        revision,
        approvalToken: auth.token
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

  if (isPost && pathname === '/api/agent/approve') {
    const body = await readJson(req)
    const approvalId = String(body.approvalId || '')
    if (!approvalId) throw new Error('缺少审批编号。')
    if (!isApprovalOwner(approvalId, auth.token)) {
      sendJson(res, 403, { error: '审批不存在或不属于当前账号。' })
      return
    }
    const ok = resolveApproval(approvalId, body.approve === true)
    if (!ok) {
      sendJson(res, 404, { error: '审批不存在或已处理。' })
      return
    }
    sendJson(res, 200, { ok: true })
    return
  }

  if (isPost && pathname === '/api/session/restore') {
    const body = await readJson(req)
    const sessionId = String(body.sessionId || '')
    const workspace = sessionWorkspace(auth.session.data, sessionId)
    if (!workspace) throw new Error('会话不存在或未关联工作区。')
    const revision = await createRevision(workspace, sessionId)
    const round = body.boundary == null ? null : Math.max(-1, Math.floor(Number(body.boundary)))
    const result = body.restoreTo
      ? await revision.restoreTo(round == null || round < 0 ? null : round)
      : await revision.restore(round == null ? -1 : round)
    sendJson(res, 200, { ok: true, ...result })
    return
  }

  if (isPost && pathname === '/api/session/fork') {
    const body = await readJson(req)
    const toSessionId = String(body.toSessionId || '')
    if (!toSessionId) throw new Error('缺少目标会话。')
    if (body.fromMain === true) {
      // 新模型：从主分支分叉，全新空会话
      const projects = Array.isArray(auth.session.data?.projects) ? auth.session.data.projects : []
      const toWorkspace = sessionWorkspace(auth.session.data, toSessionId) || String(body.workspace || '').trim()
      if (!projects.some((project) => project?.directoryName === toWorkspace)) {
        throw new Error('目标会话未关联有效的工作区。')
      }
      const revision = await createRevision(toWorkspace, toSessionId)
      const result = await revision.forkFromMain(toSessionId, typeof body.name === 'string' ? body.name : '')
      sendJson(res, 200, { ok: true, ...result })
      return
    }
    const fromSessionId = String(body.fromSessionId || '')
    const fromWorkspace = sessionWorkspace(auth.session.data, fromSessionId)
    if (!fromWorkspace) throw new Error('源会话不存在或未关联工作区。')
    // 目标会话可能是刚创建、vault 尚未同步的新会话：账号内信任其归属同一工作区
    const toWorkspace = sessionWorkspace(auth.session.data, toSessionId) || fromWorkspace
    if (toWorkspace !== fromWorkspace) throw new Error('分支会话必须属于同一个工作区。')
    const revision = await createRevision(fromWorkspace, fromSessionId)
    const boundary = body.boundary == null ? null : Math.max(-1, Math.floor(Number(body.boundary)))
    const result = await revision.fork(toSessionId, boundary)
    sendJson(res, 200, { ok: true, ...result })
    return
  }

  if (isPost && pathname === '/api/session/merge') {
    const body = await readJson(req)
    const sessionId = String(body.sessionId || '')
    const workspace = sessionWorkspace(auth.session.data, sessionId)
    if (!workspace) throw new Error('会话不存在或未关联工作区。')
    const revision = await createRevision(workspace, sessionId)
    const result = await revision.merge()
    sendJson(res, 200, { ok: true, ...result })
    return
  }

  if (isPost && pathname === '/api/session/clear') {
    const body = await readJson(req)
    const sessionId = String(body.sessionId || '')
    const workspace = sessionWorkspace(auth.session.data, sessionId)
    if (!workspace) throw new Error('会话不存在或未关联工作区。')
    const revision = await createRevision(workspace, sessionId)
    const result = await revision.clear()
    sendJson(res, 200, { ok: true, ...result })
    return
  }

  if (isPost && pathname === '/api/session/delete-snapshots') {
    const body = await readJson(req)
    const sessionId = String(body.sessionId || '')
    const workspace = sessionWorkspace(auth.session.data, sessionId)
    if (sessionId && workspace) {
      const revision = await createRevision(workspace, sessionId)
      await revision.destroy()
    }
    sendJson(res, 200, { ok: true })
    return
  }

  if (isPost && pathname === '/api/session/graph') {
    const body = await readJson(req)
    const workspace = typeof body.workspace === 'string' ? body.workspace.trim() : ''
    const projects = Array.isArray(auth.session.data?.projects) ? auth.session.data.projects : []
    if (!projects.some((project) => project?.directoryName === workspace)) {
      throw new Error('工作区不在当前账号的项目目录中。')
    }
    const revision = await createRevision(workspace, 'graph')
    const graph = await revision.graph()
    sendJson(res, 200, { ok: true, ...graph })
    return
  }

  if (isPost && pathname === '/api/session/round-diff') {
    const body = await readJson(req)
    const workspace = typeof body.workspace === 'string' ? body.workspace.trim() : ''
    const projects = Array.isArray(auth.session.data?.projects) ? auth.session.data.projects : []
    if (!projects.some((project) => project?.directoryName === workspace)) {
      throw new Error('工作区不在当前账号的项目目录中。')
    }
    const revision = await createRevision(workspace, 'diff')
    const patch = await revision.diff(String(body.sha || '').replace(/[^0-9a-f]/gi, ''))
    sendJson(res, 200, { ok: true, patch })
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

