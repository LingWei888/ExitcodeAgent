import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { DATA_DIR } from './vault.mjs'
import {
  ensureTracked,
  forkStore,
  loadSnapshotStore,
  overlayStore,
  recordWrite,
  removeSnapshotStore,
  restoreFiles,
  saveSnapshotStore
} from './snapshots.mjs'

const exec = promisify(execFile)
const TMP_INDEX_DIR = join(DATA_DIR, 'tmp-index')
const META_DIR = join(DATA_DIR, 'gitmeta')
// v1 全局线性链引用，仅供老数据迁移
const ROUND_REF = 'refs/heads/agent-rounds'
// v2：主分支与每条会话分支，全部在 agent 命名空间下，不碰用户仓库自己的分支
const MAIN_REF = 'refs/heads/agent-main'
const BRANCH_PREFIX = 'refs/heads/agent/'
// Windows CRLF 保真：让 blob 与文件字节一致，回写时不把文件悄悄翻成 LF
const GITFLAGS = ['-c', 'core.autocrlf=false']

function branchRef(sessionId) {
  return BRANCH_PREFIX + sessionId
}

function repoKey(workspace) {
  return resolve(workspace).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120)
}

function metaFile(workspace) {
  return join(META_DIR, `${repoKey(workspace)}.json`)
}

async function gitOut(workspace, args, env = {}) {
  const { stdout } = await exec('git', [...GITFLAGS, ...args], {
    cwd: workspace,
    env: { ...process.env, ...env },
    maxBuffer: 64 * 1024 * 1024
  })
  return stdout.trim()
}

function gitRun(workspace, args, env = {}) {
  return gitOut(workspace, args, env)
}

async function isGitRepo(workspace) {
  try {
    await gitRun(workspace, ['rev-parse', '--is-inside-work-tree'])
    return true
  } catch {
    return false
  }
}

// —— 工作区级串行锁：meta 的读-改-写与 ref 更新必须原子（同工作区可能并发跑多个 agent）
const workspaceLocks = new Map()
function withWorkspaceLock(workspace, fn) {
  const key = repoKey(workspace)
  const previous = workspaceLocks.get(key) ?? Promise.resolve()
  const release = () => {
    if (workspaceLocks.get(key) === gate) workspaceLocks.delete(key)
  }
  const run = previous.then(fn)
  const gate = run.then(release, release)
  workspaceLocks.set(key, gate)
  return run
}

let indexCounter = 0
function tmpIndexPath() {
  indexCounter++
  return join(TMP_INDEX_DIR, `idx-${process.pid}-${Date.now()}-${indexCounter}.index`)
}

async function withTmpIndex(workspace, fn) {
  await mkdir(TMP_INDEX_DIR, { recursive: true })
  const idx = tmpIndexPath()
  try {
    return await fn(idx)
  } finally {
    await rm(idx, { force: true })
  }
}

async function resolveRef(workspace, ref) {
  const out = await gitRun(workspace, ['rev-parse', '--verify', '--quiet', ref]).catch(() => '')
  return out || null
}

async function treeOf(workspace, commit) {
  return gitRun(workspace, ['rev-parse', `${commit}^{tree}`]).catch(() => null)
}

async function parentOf(workspace, commit) {
  const out = await gitRun(workspace, ['rev-parse', '--verify', '--quiet', `${commit}^`]).catch(() => '')
  return out || null
}

// —— meta（v2）：{ version, seq, main: { tipCommit }, branches: { [sessionId]: { name, forkFrom, forkRound, forkCommit, createdAt, tipCommit } } }
async function loadMeta(workspace) {
  let meta
  try {
    meta = JSON.parse(await readFile(metaFile(workspace), 'utf8'))
  } catch {
    return { version: 2, seq: 0, main: { tipCommit: null }, branches: {} }
  }
  if ((meta.version ?? 1) < 2) {
    const migrated = await migrateV1(workspace, meta)
    await saveMeta(workspace, migrated)
    return migrated
  }
  return meta
}

async function saveMeta(workspace, meta) {
  await mkdir(META_DIR, { recursive: true })
  await writeFile(metaFile(workspace), JSON.stringify(meta), 'utf8')
}

// —— v1 → v2：老 sessions 各自落地为分支 ref，agent-main 指向老链 tip；幂等，可重复执行
async function migrateV1(workspace, oldMeta) {
  const next = {
    version: 2,
    seq: oldMeta.seq ?? 0,
    main: { tipCommit: null },
    branches: {}
  }
  const legacySessions = oldMeta.sessions ?? {}
  const commits = await globalCommits(workspace)
  const lastBySession = new Map()
  for (const c of commits) lastBySession.set(c.session, c)
  const ids = new Set([...Object.keys(legacySessions), ...lastBySession.keys()])
  for (const sessionId of ids) {
    const info = legacySessions[sessionId]
    const last = lastBySession.get(sessionId)
    const tipCommit = info?.tipCommit || last?.sha || null
    const forkCommit = info?.forkCommit ?? null
    if (tipCommit && tipCommit !== forkCommit) {
      await gitRun(workspace, ['update-ref', branchRef(sessionId), tipCommit]).catch(() => undefined)
    }
    next.branches[sessionId] = {
      name: '',
      forkFrom: info?.forkFrom ?? (forkCommit ? 'main' : null),
      forkRound: info?.forkRound ?? null,
      forkCommit,
      tipCommit,
      createdAt: new Date().toISOString()
    }
  }
  const roundTip = await resolveRef(workspace, ROUND_REF)
  if (roundTip) {
    await gitRun(workspace, ['update-ref', MAIN_REF, roundTip]).catch(() => undefined)
    next.main.tipCommit = roundTip
  }
  return next
}

// 老链解析：仅供迁移。每行：sha \t seq \t sessionId \t round
async function globalCommits(workspace) {
  const head = await resolveRef(workspace, ROUND_REF)
  if (!head) return []
  const raw = await gitRun(workspace, ['log', ROUND_REF, '--format=%H%x09%s']).catch(() => '')
  const out = []
  for (const line of raw.split('\n')) {
    if (!line) continue
    const tab = line.indexOf('\t')
    if (tab < 0) continue
    const sha = line.slice(0, tab)
    const m = line.slice(tab + 1).match(/^\[(\d+)\]\s+(\S+)\s+round\s+(\d+)/)
    if (!m) continue
    out.push({ sha, seq: Number(m[1]), session: m[2], round: Number(m[3]) })
  }
  return out
}

// —— 该会话分支链上自己的提交（按 [seq] 升序；老链祖先会穿其它会话，按提交消息的 sessionId 过滤）
async function branchCommits(workspace, sessionId) {
  const head = await resolveRef(workspace, branchRef(sessionId))
  if (!head) return []
  const raw = await gitRun(workspace, ['log', branchRef(sessionId), '--format=%H%x09%s']).catch(() => '')
  const out = []
  for (const line of raw.split('\n')) {
    if (!line) continue
    const tab = line.indexOf('\t')
    if (tab < 0) continue
    const sha = line.slice(0, tab)
    const m = line.slice(tab + 1).match(/^\[(\d+)\]\s+(\S+)\s+round\s+(\d+)/)
    if (!m || m[2] !== sessionId) continue
    out.push({ sha, seq: Number(m[1]), session: m[2], round: Number(m[3]) })
  }
  return out.sort((a, b) => a.seq - b.seq)
}

async function commitFiles(workspace, sha) {
  const base = ['diff-tree', '-r', '-M', '--no-commit-id', '--root']
  const rawNames = await gitRun(workspace, [...base, '--name-status', sha]).catch(() => '')
  const rawNums = await gitRun(workspace, [...base, '--numstat', sha]).catch(() => '')
  const nums = new Map()
  for (const line of rawNums.split('\n')) {
    const parts = line.split('\t')
    if (parts.length < 3) continue
    nums.set(parts.slice(2).join('\t'), {
      add: parts[0] === '-' ? null : Number(parts[0]),
      del: parts[1] === '-' ? null : Number(parts[1])
    })
  }
  const files = []
  for (const line of rawNames.split('\n')) {
    const parts = line.split('\t')
    if (parts.length < 2) continue
    const status = parts[0]
    const path = parts.length >= 3 && /^R|^C/i.test(status) ? parts[2] : parts[1]
    const stats = nums.get(path)
    files.push({ path, status, add: stats?.add ?? null, del: stats?.del ?? null })
  }
  return files
}

// —— 该会话分支链改走过的路径并集（替代 v1 的全局并集 agentPathUnion）
async function branchPathUnion(workspace, sessionId) {
  const commits = await branchCommits(workspace, sessionId)
  const paths = new Set()
  for (const c of commits) {
    for (const f of await commitFiles(workspace, c.sha)) paths.add(f.path)
  }
  return paths
}

// —— 把文件恢复到边界树状态，只动传入的路径（git checkout 语义）
async function applyTreePaths(workspace, boundaryTree, paths) {
  const root = resolve(workspace)
  const restored = []
  if (!paths.size) return restored
  const rows = boundaryTree ? await gitRun(workspace, ['ls-tree', '-r', '--name-only', '-z', boundaryTree]).catch(() => '') : ''
  const inTree = new Set()
  if (rows) {
    for (const name of rows.split('\0').filter(Boolean)) {
      const full = resolve(root, name)
      if (full === root || full.startsWith(root + sep)) inTree.add(full)
    }
  }
  for (const rel of paths) {
    const full = resolve(root, rel)
    if (full === root || !full.startsWith(root + sep)) continue
    if (inTree.has(full)) {
      const content = await gitRun(workspace, ['show', `${boundaryTree}:${rel}`]).catch(() => null)
      if (content === null) continue
      await mkdir(dirname(full), { recursive: true })
      await writeFile(full, content, 'utf8')
      restored.push({ path: rel, action: 'write' })
    } else {
      await rm(full, { force: true }).catch(() => undefined)
      restored.push({ path: rel, action: 'delete' })
    }
  }
  return restored
}

async function commitTouchedPaths(workspace, sessionId) {
  return branchPathUnion(workspace, sessionId)
}

// —— 撤销：把该会话在第 boundary 轮完成之后改过的文件恢复到边界状态（只动本会话的路径）
async function restoreBoundary(workspace, sessionId, boundary) {
  const commits = await branchCommits(workspace, sessionId)
  const target = [...commits.filter((c) => c.round <= boundary)].pop()
  let boundaryTree = target ? await treeOf(workspace, target.sha) : null
  if (!boundaryTree) {
    const meta = await loadMeta(workspace)
    const forkCommit = meta.branches[sessionId]?.forkCommit ?? null
    if (forkCommit) boundaryTree = await treeOf(workspace, forkCommit)
  }
  const paths = await commitTouchedPaths(workspace, sessionId)
  // 边界树缺失时安全空操作，绝不把文件全删
  const restored = boundaryTree ? await applyTreePaths(workspace, boundaryTree, paths) : []
  const last = commits.length ? commits[commits.length - 1] : null
  return { restored, tipCommit: last?.sha ?? null, tipRound: last?.round ?? null }
}

// —— 还原（含文件）：把该会话的文件恢复到第 roundTo 轮完成后的最新状态（撤销的逆操作）
async function restoreToState(workspace, sessionId, roundTo) {
  const commits = await branchCommits(workspace, sessionId)
  const target = roundTo == null ? commits[commits.length - 1] : [...commits.filter((c) => c.round <= roundTo)].pop()
  if (!target) return { restored: [], tipCommit: null, tipRound: null }
  const boundaryTree = await treeOf(workspace, target.sha)
  const paths = await commitTouchedPaths(workspace, sessionId)
  const restored = boundaryTree ? await applyTreePaths(workspace, boundaryTree, paths) : []
  const last = commits.length ? commits[commits.length - 1] : null
  return { restored, tipCommit: last?.sha ?? null, tipRound: last?.round ?? null }
}

// —— 初始化：确保工作区有 git 仓库，且 agent-main 恒存在（所有分支共享祖先，merge 永远可用）
async function ensureRepo(workspace) {
  if (!(await isGitRepo(workspace))) {
    await gitRun(workspace, ['init', '-b', 'main']).catch(() => gitRun(workspace, ['init']))
  }
}

async function ensureAgentMain(workspace) {
  // 调用方都持工作区锁（recordRound / forkSession / forkFromMain / mergeToMain / clearSession），
  // 这里不再嵌套加锁，避免死锁
  const existing = await resolveRef(workspace, MAIN_REF)
  if (existing) return existing
  const tree = await withTmpIndex(workspace, async (idx) => {
    const env = { GIT_INDEX_FILE: idx }
    const headTree = await gitRun(workspace, ['rev-parse', '--verify', '--quiet', 'HEAD^{tree}'], env).catch(() => '')
    if (headTree) return headTree
    await gitRun(workspace, ['read-tree', '--empty'], env)
    await gitRun(workspace, ['add', '-A', '.'], env)
    return gitRun(workspace, ['write-tree'], env)
  })
  const commit = await gitRun(workspace, ['commit-tree', tree, '-m', 'agent base'])
  await gitRun(workspace, ['update-ref', MAIN_REF, commit])
  const meta = await loadMeta(workspace)
  meta.main.tipCommit = commit
  await saveMeta(workspace, meta)
  return commit
}

// —— 每轮写入一个真实 git 提交，挂在所属会话分支的分支链上（不触碰用户自己的分支与工作区暂存区）
async function recordRound(workspace, sessionId, round, title, paths) {
  const clean = [...new Set(paths.map((p) => String(p)).filter(Boolean))]
  if (!clean.length) return null
  return withWorkspaceLock(workspace, async () => {
    await ensureRepo(workspace)
    await mkdir(META_DIR, { recursive: true })
    const meta = await loadMeta(workspace)
    let parent = await resolveRef(workspace, branchRef(sessionId))
    let forkCommit = meta.branches[sessionId]?.forkCommit ?? null
    if (!parent) {
      // 惰性建分支：会话可能没经过 fork 请求（例如侧边栏首次新建会话），以主分支为分叉起点
      if (!forkCommit) {
        const mainTip = await ensureAgentMain(workspace)
        forkCommit = mainTip
        meta.branches[sessionId] = {
          name: '', forkFrom: 'main', forkRound: -1, forkCommit,
          tipCommit: null, createdAt: new Date().toISOString()
        }
      }
      parent = forkCommit
    }
    const parentTree = parent ? await treeOf(workspace, parent) : null
    const commit = await withTmpIndex(workspace, async (idx) => {
      const env = { GIT_INDEX_FILE: idx }
      if (parentTree) await gitRun(workspace, ['read-tree', parentTree], env)
      else await gitRun(workspace, ['read-tree', '--empty'], env)
      await gitRun(workspace, ['add', '-A', '--', ...clean], env)
      const tree = await gitRun(workspace, ['write-tree'], env)
      const seq = meta.seq + 1
      const msg = `[${seq}] ${sessionId} round ${round}${title ? ` - ${title}` : ''}`
      const args = ['commit-tree', tree, '-m', msg]
      if (parent) args.push('-p', parent)
      return gitRun(workspace, args, env)
    })
    await gitRun(workspace, ['update-ref', branchRef(sessionId), commit])
    meta.seq += 1
    const entry = (meta.branches[sessionId] ??= {
      name: '', forkFrom: 'main', forkRound: -1, forkCommit,
      tipCommit: null, createdAt: new Date().toISOString()
    })
    entry.tipCommit = commit
    await saveMeta(workspace, meta)
    return commit
  })
}

// —— 分叉（旧语义，兼容）：新会话以源会话第 boundary 轮完成后的文件状态为起点
async function forkSession(workspace, fromSessionId, toSessionId, boundary) {
  return withWorkspaceLock(workspace, async () => {
    await ensureRepo(workspace)
    const meta = await loadMeta(workspace)
    const commits = await branchCommits(workspace, fromSessionId)
    const b = boundary == null ? Number.POSITIVE_INFINITY : boundary
    let forkCommit = null
    const target = [...commits.filter((c) => c.round <= b)].pop()
    if (target) {
      forkCommit = target.sha
    } else if (commits.length) {
      const info = meta.branches[fromSessionId]
      forkCommit = info?.forkCommit || (await parentOf(workspace, commits[0].sha))
    } else {
      forkCommit = await ensureAgentMain(workspace)
    }
    meta.branches[toSessionId] = {
      name: '',
      forkFrom: fromSessionId,
      forkRound: boundary == null ? -1 : boundary,
      forkCommit,
      tipCommit: null,
      createdAt: new Date().toISOString()
    }
    await saveMeta(workspace, meta)
    return { ok: true, forkCommit }
  })
}

// —— 新模型：从主分支分叉，全新空会话
async function forkFromMain(workspace, toSessionId, name) {
  return withWorkspaceLock(workspace, async () => {
    await ensureRepo(workspace)
    const forkCommit = await ensureAgentMain(workspace)
    const meta = await loadMeta(workspace)
    meta.branches[toSessionId] = {
      name: name ?? '',
      forkFrom: 'main', forkRound: -1, forkCommit,
      tipCommit: null, createdAt: new Date().toISOString()
    }
    await saveMeta(workspace, meta)
    return { ok: true, forkCommit }
  })
}

async function isAncestor(workspace, ancestor, tip) {
  try {
    await gitRun(workspace, ['merge-base', '--is-ancestor', ancestor, tip])
    return true
  } catch {
    return false
  }
}

let cachedGitVersion = 0
async function gitSupportsMergeTree() {
  if (!cachedGitVersion) {
    try {
      const { stdout } = await exec('git', ['version'])
      const m = stdout.match(/git version (\d+)\.(\d+)/)
      cachedGitVersion = m ? Number(m[1]) * 100 + Number(m[2]) : 0
    } catch {
      cachedGitVersion = 0
    }
  }
  return cachedGitVersion >= 238
}

// —— 三向合并：返回合并后的树；冲突时返回冲突文件列表（不改任何 ref）
async function computeMergeTree(workspace, ours, theirs) {
  try {
    const { stdout } = await exec('git', [...GITFLAGS, '-c', 'core.quotePath=false', 'merge-tree', '--write-tree', ours, theirs], {
      cwd: workspace,
      env: { ...process.env },
      maxBuffer: 64 * 1024 * 1024
    })
    return { clean: true, tree: stdout.split('\n', 1)[0].trim() }
  } catch (error) {
    if (error && error.code === 1) {
      // 冲突：stdout = 树 OID \n <mode> <oid> <stage>TAB<filename> ... \n 空行 \n 消息
      // （-c core.quotePath=false 保证中文/空格文件名未转义；stage 与文件名之间是 TAB）
      const lines = String(error.stdout || '').split('\n')
      const conflicts = []
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i]
        if (!line) break
        const m = line.match(/^(\S+)\s+(\S+)\s+(\d+)\t(.*)$/)
        if (m) conflicts.push(m[4])
      }
      return { clean: false, conflicts: [...new Set(conflicts)] }
    }
    throw error
  }
}

// —— 合并分支到主分支：只推进 agent-main ref，不写工作区文件
async function mergeToMain(workspace, sessionId) {
  return withWorkspaceLock(workspace, async () => {
    await ensureRepo(workspace)
    const branchTip = await resolveRef(workspace, branchRef(sessionId))
    if (!branchTip) return { ok: false, code: 'no-commits', error: '该会话还没有产生提交，无法合并。' }
    const mainTip = await ensureAgentMain(workspace)
    const meta = await loadMeta(workspace)
    if (await isAncestor(workspace, branchTip, mainTip)) {
      return { ok: true, merged: 'already' }
    }
    if (await isAncestor(workspace, mainTip, branchTip)) {
      await gitRun(workspace, ['update-ref', MAIN_REF, branchTip])
      meta.seq += 1
      meta.main.tipCommit = branchTip
      await saveMeta(workspace, meta)
      return { ok: true, fastForward: true, mergedSha: branchTip }
    }
    if (!(await gitSupportsMergeTree())) {
      return { ok: false, code: 'git-version', error: '服务器 git 版本过低（需要 ≥2.38），暂不支持自动合并。' }
    }
    const result = await computeMergeTree(workspace, mainTip, branchTip)
    if (!result.clean) {
      return { ok: false, code: 'conflict', conflicts: result.conflicts, error: '合并存在冲突。' }
    }
    meta.seq += 1
    const name = meta.branches[sessionId]?.name || ''
    const mergeCommit = await gitRun(workspace, [
      'commit-tree', result.tree,
      '-p', mainTip, '-p', branchTip,
      '-m', `[${meta.seq}] merge ${sessionId}`
    ])
    await gitRun(workspace, ['update-ref', MAIN_REF, mergeCommit])
    meta.main.tipCommit = mergeCommit
    await saveMeta(workspace, meta)
    return { ok: true, mergedSha: mergeCommit, branchName: name }
  })
}

// —— 清空聊天记录：删除该分支的提交链、把分支基线重置为主分支（文件保留不动）
// 原因：round 编号 = 该轮开始前的用户消息数 - 1，清空消息后新一轮 round 从 0 重排，
// 若不重置链会与旧提交的 round 撞号导致撤销错位
async function clearSession(workspace, sessionId) {
  return withWorkspaceLock(workspace, async () => {
    await ensureRepo(workspace)
    const meta = await loadMeta(workspace)
    const mainTip = await ensureAgentMain(workspace)
    await gitRun(workspace, ['update-ref', '-d', branchRef(sessionId)]).catch(() => undefined)
    meta.branches[sessionId] = {
      name: meta.branches[sessionId]?.name ?? '',
      forkFrom: 'main', forkRound: -1, forkCommit: mainTip,
      tipCommit: null, createdAt: new Date().toISOString()
    }
    await saveMeta(workspace, meta)
    return { ok: true }
  })
}

async function deleteSession(workspace, sessionId) {
  return withWorkspaceLock(workspace, async () => {
    const meta = await loadMeta(workspace)
    delete meta.branches[sessionId]
    await saveMeta(workspace, meta)
    await gitRun(workspace, ['update-ref', '-d', branchRef(sessionId)]).catch(() => undefined)
    return { ok: true }
  })
}

// 单轮提交的完整 diff 文本
async function roundDiff(workspace, sha) {
  return gitRun(workspace, ['diff-tree', '-r', '-M', '--no-commit-id', '--root', '-p', sha]).catch(() => '')
}

// —— 主分支链：合并提交 + 迁移带入的老轮次提交（round=null 表示合并提交）
async function mainChainCommits(workspace) {
  const head = await resolveRef(workspace, MAIN_REF)
  if (!head) return []
  const raw = await gitRun(workspace, ['log', '--first-parent', MAIN_REF, '--format=%H%x09%s']).catch(() => '')
  const out = []
  for (const line of raw.split('\n')) {
    if (!line) continue
    const tab = line.indexOf('\t')
    if (tab < 0) continue
    const sha = line.slice(0, tab)
    const m = line.slice(tab + 1).match(/^\[(\d+)\]\s+(.+)$/)
    if (!m) continue
    const rest = m[2]
    const merge = rest.match(/^merge\s+(\S+)/)
    let sessionId = 'main'
    let round = null
    let mergedSession = undefined
    if (merge) {
      mergedSession = merge[1]
    } else {
      const rr = rest.match(/^(\S+)\s+round\s+(\d+)/)
      if (!rr) continue
      sessionId = rr[1]
      round = Number(rr[2])
    }
    const files = await commitFiles(workspace, sha)
    out.push({ sha, seq: Number(m[1]), session: sessionId, round, merge: !!merge, mergedSession, files })
  }
  return out
}

// —— 分支图数据：主分支 + 全部分支（含各自提交与改动）
async function graphData(workspace) {
  const meta = await loadMeta(workspace)
  const mainTip = await resolveRef(workspace, MAIN_REF)
  const mainCommits = await mainChainCommits(workspace)
  const list = []
  for (const [sessionId, info] of Object.entries(meta.branches ?? {})) {
    const commits = await branchCommits(workspace, sessionId)
    const withFiles = []
    for (const c of commits) {
      const files = await commitFiles(workspace, c.sha)
      withFiles.push({ ...c, files })
    }
    list.push({
      sessionId,
      name: info?.name ?? '',
      forkFrom: info?.forkFrom ?? null,
      forkRound: info?.forkRound ?? null,
      forkCommit: info?.forkCommit ?? null,
      mergedIntoMain: !!mainTip && withFiles.length > 0
        ? await isAncestor(workspace, commits[commits.length - 1].sha, mainTip)
        : false,
      commits: withFiles
    })
  }
  return { main: { tipCommit: mainTip, commits: mainCommits }, branches: list }
}

// —— 统一入口：git 可用走 git；否则退回 JSON 快照
export async function createRevision(workspace, sessionId) {
  await mkdir(TMP_INDEX_DIR, { recursive: true })
  let gitOk = false
  try {
    await ensureRepo(workspace)
    gitOk = await isGitRepo(workspace)
  } catch {
    gitOk = false
  }
  let snapshotStore = null
  if (!gitOk) snapshotStore = await loadSnapshotStore(sessionId)
  const mainStoreKey = `${repoKey(workspace)}-main`

  return {
    useGit: gitOk,
    async beforeWrites(paths) {
      if (gitOk || !snapshotStore) return
      for (const path of paths) {
        await ensureTracked(snapshotStore, path).catch(() => undefined)
      }
    },
    async afterWrites(round, title, writes) {
      if (gitOk) {
        await recordRound(workspace, sessionId, round, title.slice(0, 120), writes.map((w) => w.path))
      } else if (snapshotStore) {
        for (const w of writes) {
          if (w.ok) await recordWrite(snapshotStore, w.path, round).catch(() => undefined)
        }
        await saveSnapshotStore(sessionId, snapshotStore)
      }
    },
    async restore(boundary) {
      if (gitOk) return restoreBoundary(workspace, sessionId, boundary)
      const restored = await restoreFiles(snapshotStore ?? (await loadSnapshotStore(sessionId)), boundary, workspace)
      return { restored, tipCommit: null, tipRound: null }
    },
    async restoreTo(roundTo) {
      if (gitOk) return restoreToState(workspace, sessionId, roundTo)
      const restored = await restoreFiles(
        snapshotStore ?? (await loadSnapshotStore(sessionId)),
        roundTo == null ? Number.POSITIVE_INFINITY : roundTo,
        workspace
      )
      return { restored, tipCommit: null, tipRound: null }
    },
    async fork(toSessionId, boundary) {
      if (gitOk) return forkSession(workspace, sessionId, toSessionId, boundary)
      await saveSnapshotStore(
        toSessionId,
        forkStore(snapshotStore ?? (await loadSnapshotStore(sessionId)), boundary === null ? Number.POSITIVE_INFINITY : boundary)
      )
      return { ok: true }
    },
    async forkFromMain(toSessionId, name) {
      if (gitOk) return forkFromMain(workspace, toSessionId, name)
      const mainStore = await loadSnapshotStore(mainStoreKey)
      await saveSnapshotStore(toSessionId, forkStore(mainStore, Number.POSITIVE_INFINITY))
      return { ok: true }
    },
    async merge() {
      if (gitOk) return mergeToMain(workspace, sessionId)
      const mainStore = await loadSnapshotStore(mainStoreKey)
      const merged = overlayStore(mainStore, snapshotStore ?? (await loadSnapshotStore(sessionId)))
      await saveSnapshotStore(mainStoreKey, merged)
      return { ok: true, merged: 'file' }
    },
    async clear() {
      if (gitOk) return clearSession(workspace, sessionId)
      await removeSnapshotStore(sessionId)
      const mainStore = await loadSnapshotStore(mainStoreKey)
      await saveSnapshotStore(sessionId, forkStore(mainStore, Number.POSITIVE_INFINITY))
      return { ok: true }
    },
    async graph() {
      if (gitOk) return graphData(workspace)
      return { main: { tipCommit: null, commits: [] }, branches: [] }
    },
    async diff(sha) {
      if (gitOk) return roundDiff(workspace, sha)
      return ''
    },
    async destroy() {
      if (gitOk) await deleteSession(workspace, sessionId)
      else await removeSnapshotStore(sessionId)
      return { ok: true }
    }
  }
}

export function repoKeyFor(workspace) {
  return repoKey(workspace)
}