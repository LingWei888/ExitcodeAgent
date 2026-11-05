import { mkdir, readFile, stat, unlink, writeFile, rm } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { DATA_DIR } from './vault.mjs'

const SNAPSHOT_DIR = resolve(DATA_DIR, 'snapshots')

function snapshotFile(sessionId) {
  const safe = String(sessionId).replace(/[^a-zA-Z0-9_-]/g, '_')
  return join(SNAPSHOT_DIR, `${safe}.json`)
}

function isInside(root, target) {
  return target === root || target.startsWith(root + sep)
}

// 按会话记录每个被写入文件在不同轮次的版本，用于 git 式回滚与分支。
// store 结构：{ version: 1, entries: { [绝对路径]: { existed, original, binary, writes: [{ runId, after }] } } }
// runId = 该轮开始前已有的用户消息数（第 0 轮、第 1 轮……）。

export async function loadSnapshotStore(sessionId) {
  try {
    const text = await readFile(snapshotFile(sessionId), 'utf8')
    return JSON.parse(text)
  } catch {
    return { version: 1, entries: {} }
  }
}

export async function saveSnapshotStore(sessionId, store) {
  await mkdir(SNAPSHOT_DIR, { recursive: true })
  await writeFile(snapshotFile(sessionId), JSON.stringify(store), 'utf8')
}

export async function removeSnapshotStore(sessionId) {
  await rm(snapshotFile(sessionId), { force: true })
}

async function readFullText(path) {
  try {
    const fileStat = await stat(path)
    if (!fileStat.isFile()) return { existed: false, text: null }
    const content = await readFile(path, 'utf8')
    return { existed: true, text: content.includes('\u0000') ? null : content }
  } catch {
    return { existed: false, text: null }
  }
}

// 在写入前调用：首次遇到的路径记录其当前内容作为“原始版本”
export async function ensureTracked(store, path) {
  if (store.entries[path]) return
  const { existed, text } = await readFullText(path)
  store.entries[path] = {
    existed,
    original: existed && text !== null ? text : null,
    binary: existed && text === null,
    writes: []
  }
}

// 在写入成功后调用：记录该文件在这一轮之后的内容
export async function recordWrite(store, path, runId) {
  const entry = store.entries[path]
  if (!entry || entry.binary) return
  const { existed, text } = await readFullText(path)
  if (!existed || text === null) return
  entry.writes.push({ runId, after: text })
}

// 文件在“第 boundary 轮完成后”的内容
function stateAt(entry, boundary) {
  let existed = entry.existed
  let current = entry.existed ? entry.original : null
  for (const w of entry.writes) {
    if (w.runId <= boundary) {
      current = w.after
      existed = true
    }
  }
  return { existed, content: current }
}

// 把所有跟踪过的文件回滚到指定轮边界后的状态（boundary 传 Infinity 表示最新，用于还原撤销）
export async function restoreFiles(store, boundary, scopeRoot) {
  const root = resolve(scopeRoot)
  const applied = []
  for (const [path, entry] of Object.entries(store.entries ?? {})) {
    if (entry.binary || !isInside(root, path)) continue
    const target = stateAt(entry, boundary)
    if (target.existed) {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, target.content, 'utf8')
    } else {
      await unlink(path).catch(() => undefined)
    }
    applied.push({ path, action: target.existed ? 'write' : 'delete' })
  }
  return applied
}

// 非 git 模式的“合并到主分支”：以 overlay 各条目的当前最新状态覆盖 base 的对应路径
export function overlayStore(base, overlay) {
  const out = { version: 1, entries: { ...(base?.entries ?? {}) } }
  for (const [path, entry] of Object.entries(overlay?.entries ?? {})) {
    if (entry.binary) {
      out.entries[path] = { ...entry, writes: [] }
      continue
    }
    const state = stateAt(entry, Number.POSITIVE_INFINITY)
    out.entries[path] = { existed: state.existed, original: state.content, binary: false, writes: [] }
  }
  return out
}

// 分支：以“第 boundary 轮完成后”的文件状态作为新会话的起点（boundary 传 Infinity 表示当前最新状态）
export function forkStore(store, boundary) {
  const out = { version: 1, entries: {} }
  for (const [path, entry] of Object.entries(store.entries ?? {})) {
    if (entry.binary) {
      out.entries[path] = { ...entry, writes: [] }
      continue
    }
    const base = stateAt(entry, boundary)
    out.entries[path] = { existed: base.existed, original: base.content, binary: false, writes: [] }
  }
  return out
}