import { mkdir, open, readdir, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { dirname, resolve, sep } from 'node:path'

const workspaceRoot = process.env.EXITCODE_WORKSPACE_ROOT ? resolve(process.env.EXITCODE_WORKSPACE_ROOT) : null
const MAX_TOOL_READ_BYTES = 256 * 1024
const MAX_SEARCH_SCAN_BYTES = 32 * 1024 * 1024
const READ_RANGE_MAX_BYTES = 4 * 1024 * 1024
const MAX_EDIT_FILE_BYTES = 512 * 1024
const GLOB_MAX_RESULTS = 200
const GLOB_MAX_SCAN_ENTRIES = 20000
const IGNORED_DIRS = new Set(['.git', '.svn', '.hg', 'node_modules', 'dist', 'build', 'coverage', '.cache', '.next', '.venv', 'vendor', 'tmp', '.tmp', '.exitcode', '.pnpm-store', '.idea'])

const yieldLoop = () => new Promise((resolve) => setImmediate(resolve))

function isInside(root, target) {
  return target === root || target.startsWith(root + sep)
}

export function resolveServerPath(inputPath, scopeRoot) {
  const requested = typeof inputPath === 'string' && inputPath.trim() ? inputPath.trim() : ''
  const scope = scopeRoot ? resolve(scopeRoot) : null
  const target = requested ? (scope ? resolve(scope, requested) : resolve(requested)) : scope || workspaceRoot || os.homedir()
  if (scope && !isInside(scope, target)) {
    throw new Error('路径超出当前工作区范围。')
  }
  if (workspaceRoot && !isInside(workspaceRoot, target)) {
    throw new Error(`路径不在允许的工作区范围内：${workspaceRoot}`)
  }
  return target
}

export async function listServerDirectory(inputPath, scopeRoot) {
  const target = resolveServerPath(inputPath, scopeRoot)
  const dirents = await readdir(target, { withFileTypes: true })
  const entries = []
  for (const entry of dirents) {
    if (entries.length >= 500) break
    if (entry.isFile()) {
      try {
        const fileStat = await stat(resolve(target, entry.name))
        entries.push({ name: entry.name, kind: 'file', size: fileStat.size, path: resolve(target, entry.name) })
      } catch {
        // Unreadable files are skipped instead of failing the whole listing.
      }
    } else if (entry.isDirectory()) {
      entries.push({ name: entry.name, kind: 'directory', path: resolve(target, entry.name) })
    }
  }
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  const parent = dirname(target) === target ? null : dirname(target)
  return { path: target, parent, entries }
}

async function readTextFile(target, maxBytes) {
  const fileStat = await stat(target)
  const buffer = Buffer.alloc(Math.min(fileStat.size, maxBytes + 1))
  const handle = await open(target, 'r')
  try {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const text = buffer.subarray(0, Math.min(bytesRead, maxBytes)).toString('utf8')
    return { content: text, truncated: fileStat.size > maxBytes }
  } finally {
    await handle.close()
  }
}

export async function readServerFile(inputPath, scopeRoot, maxBytesOrOptions = MAX_TOOL_READ_BYTES, options = {}) {
  const opts = typeof maxBytesOrOptions === 'object' && maxBytesOrOptions ? maxBytesOrOptions : options
  const maxBytes = typeof maxBytesOrOptions === 'number' ? maxBytesOrOptions : MAX_TOOL_READ_BYTES
  const target = resolveServerPath(inputPath, scopeRoot)
  const fileStat = await stat(target)
  if (!fileStat.isFile()) throw new Error('目标不是文件。')
  const offset = Number(opts.offset)
  const limit = Number(opts.limit)
  const ranged = (Number.isFinite(offset) && offset > 0) || (Number.isFinite(limit) && limit > 0)
  const { content, truncated } = await readTextFile(target, ranged ? READ_RANGE_MAX_BYTES : maxBytes)
  if (content.includes('\u0000')) throw new Error('二进制文件不支持直接读取。')
  if (!ranged) return { path: target, content, size: fileStat.size, truncated }
  const lines = content.split('\n')
  const totalLines = lines.length
  const start = Number.isFinite(offset) && offset > 0 ? Math.max(0, offset - 1) : 0
  if (start >= totalLines) {
    throw new Error(`起始行超出文件范围：文件共 ${totalLines} 行，offset=${offset}。`)
  }
  const end = Number.isFinite(limit) && limit > 0 ? Math.min(totalLines, start + limit) : totalLines
  return {
    path: target,
    content: lines.slice(start, end).join('\n'),
    size: fileStat.size,
    truncated: fileStat.size > READ_RANGE_MAX_BYTES,
    totalLines,
    offset: start + 1
  }
}

export async function writeServerFile(inputPath, content, scopeRoot) {
  const target = resolveServerPath(inputPath, scopeRoot)
  let oldContent = ''
  let existed = false
  try {
    const existing = await readServerFile(target, scopeRoot, 512 * 1024)
    oldContent = existing.content
    existed = true
  } catch {
    existed = false
  }
  const normalized = String(content ?? '')
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, normalized, 'utf8')
  return {
    path: target,
    size: Buffer.byteLength(normalized, 'utf8'),
    kind: existed ? 'modified' : 'created',
    diff: makeDiff(oldContent, normalized, target)
  }
}

export function makeDiff(oldText, newText, path = '') {
  const oldLines = String(oldText || '').split('\n')
  const newLines = String(newText || '').split('\n')
  let start = 0
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start++
  let oldEnd = oldLines.length
  let newEnd = newLines.length
  while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
    oldEnd--
    newEnd--
  }
  const lines = [`--- ${path}`, `+++ ${path}`]
  for (const line of oldLines.slice(Math.max(0, start - 2), start)) lines.push(` ${line}`)
  for (const line of oldLines.slice(start, oldEnd)) lines.push(`-${line}`)
  for (const line of newLines.slice(start, newEnd)) lines.push(`+${line}`)
  for (const line of newLines.slice(newEnd, Math.min(newLines.length, newEnd + 2))) lines.push(` ${line}`)
  return lines.join('\n')
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// 单个路径段（不含 /）的 glob → 正则：支持 * ? [..] {a,b}
function globSegmentToRegExp(segment) {
  const pattern = String(segment)
  let out = ''
  let i = 0
  while (i < pattern.length) {
    const ch = pattern[i]
    if (ch === '*') out += '[^/]*'
    else if (ch === '?') out += '[^/]'
    else if (ch === '[') {
      const close = pattern.indexOf(']', i + 1)
      if (close === -1) out += '\\['
      else {
        out += pattern.slice(i, close + 1)
        i = close
      }
    } else if (ch === '{') {
      const close = pattern.indexOf('}', i + 1)
      if (close === -1) out += '\\{'
      else {
        const choices = pattern.slice(i + 1, close).split(',').map(escapeRegExp).join('|')
        out += `(?:${choices})`
        i = close
      }
    } else out += escapeRegExp(ch)
    i++
  }
  return out
}

function hasGlobMagic(pattern) {
  return /[*?[{]/.test(pattern)
}

// 按 glob 模式匹配工作区中的一组相对路径，返回匹配清单与扫描条目数（跳过 node_modules 等目录）
export async function globServerFiles(inputPattern, scopeRoot, maxResults = GLOB_MAX_RESULTS) {
  const root = resolveServerPath('', scopeRoot)
  const pattern = String(inputPattern || '').replace(/\\/g, '/').trim().replace(/^\.\//, '')
  if (!pattern) throw new Error('glob 模式不能为空，例如 "**/*.vue" 或 "src/**/*.ts"。')
  const segments = pattern.split('/').filter(Boolean)
  const matches = []
  let scanned = 0
  let truncated = false

  async function collectAll(dir, rel) {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (truncated) return
      if (matches.length >= maxResults) {
        truncated = true
        return
      }
      scanned++
      if (scanned % 16 === 0) await yieldLoop()
      const nextRel = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue
        matches.push(nextRel)
        await collectAll(resolve(dir, entry.name), nextRel)
      } else if (entry.isFile()) {
        matches.push(nextRel)
      }
    }
  }

  async function walk(segIndex, dir, rel) {
    if (truncated) return
      if (matches.length >= maxResults) {
        truncated = true
        return
      }
    if (segIndex >= segments.length) {
      matches.push(rel || '.')
      return
    }
    const seg = segments[segIndex]
    if (seg === '**') {
      // ** 先尝试匹配零层目录；若其后还有段，再递归地吃掉任意层目录
      await walk(segIndex + 1, dir, rel)
      if (truncated) return
      if (matches.length >= maxResults) {
        truncated = true
        return
      }
      if (segIndex === segments.length - 1) {
        await collectAll(dir, rel)
        return
      }
      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      entries.sort((a, b) => a.name.localeCompare(b.name))
      for (const entry of entries) {
        if (truncated) return
      if (matches.length >= maxResults) {
        truncated = true
        return
      }
        if (!entry.isDirectory() || IGNORED_DIRS.has(entry.name)) continue
        await walk(segIndex, resolve(dir, entry.name), rel ? `${rel}/${entry.name}` : entry.name)
      }
      return
    }
    const last = segIndex === segments.length - 1
    const segmentRe = new RegExp(`^${globSegmentToRegExp(seg)}$`, 'i')
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (truncated) return
      if (matches.length >= maxResults) {
        truncated = true
        return
      }
      scanned++
      if (scanned % 16 === 0) await yieldLoop()
      if (!segmentRe.test(entry.name)) continue
      const nextRel = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue
        await walk(segIndex + 1, resolve(dir, entry.name), nextRel)
      } else if (entry.isFile() && last) {
        matches.push(nextRel)
      }
      if (scanned >= GLOB_MAX_SCAN_ENTRIES) {
        truncated = true
        return
      }
    }
  }

  await walk(0, root, '')
  return { root, pattern, matches, count: matches.length, scanned, truncated }
}

// 定点文本替换编辑：edits 依次应用，每项 old_text 必须唯一（重复时需 replace_all）
export async function editServerFile(inputPath, edits, scopeRoot) {
  const target = resolveServerPath(inputPath, scopeRoot)
  const list = Array.isArray(edits) ? edits.filter(Boolean) : []
  if (!list.length || list.some((item) => typeof item.old_text !== 'string' || !item.old_text)) {
    throw new Error('edit_file 需要至少一个 {old_text, new_text} 替换项。')
  }
  const fileStat = await stat(target)
  if (!fileStat.isFile()) throw new Error('目标不是文件。')
  if (fileStat.size > MAX_EDIT_FILE_BYTES) {
    throw new Error(`文件过大（${fileStat.size} 字节 > 512KB），请改用 write_file 或先分段确认内容。`)
  }
  const original = await readTextFile(target, fileStat.size)
  if (original.content.includes('\u0000')) throw new Error('二进制文件不支持编辑。')
  let current = original.content
  let applied = 0
  for (const item of list) {
    const matches = current.split(item.old_text).length - 1
    if (matches === 0) {
      throw new Error(
        `未找到要替换的文本：${target}。请先读取文件确认内容，old_text 需与文件内容精确一致（含缩进）。`
      )
    }
    if (matches > 1 && item.replace_all !== true) {
      throw new Error(`待替换文本出现 ${matches} 次：${target}。请用足够长的上下文使其唯一，或设置 replace_all: true。`)
    }
    current = item.replace_all === true ? current.split(item.old_text).join(item.new_text ?? '') : current.replace(item.old_text, item.new_text ?? '')
    applied += matches
  }
  await writeFile(target, current, 'utf8')
  return {
    path: target,
    size: Buffer.byteLength(current, 'utf8'),
    diff: makeDiff(original.content, current, target),
    count: applied
  }
}

function compilePattern(rawPattern, caseSensitive = false) {
  const pattern = String(rawPattern || '').trim()
  if (!pattern) throw new Error('搜索关键词不能为空。')
  if (caseSensitive) {
    try {
      const regex = new RegExp(pattern)
      return { test: (line) => regex.test(line) }
    } catch {
      return { test: (line) => line.includes(pattern) }
    }
  }
  try {
    const regex = new RegExp(pattern, 'i')
    return { test: (line) => regex.test(line) }
  } catch {
    const needle = pattern.toLowerCase()
    return { test: (line) => line.toLowerCase().includes(needle) }
  }
}

export async function searchServerFiles(inputPath, rawPattern, scopeRoot, maxResultsOrOptions = 40, options = {}) {
  const opts = typeof maxResultsOrOptions === 'object' && maxResultsOrOptions ? maxResultsOrOptions : options
  const declaredMax = typeof maxResultsOrOptions === 'number' ? maxResultsOrOptions : Number(opts.max_results)
  const maxResults = Math.min(200, Math.max(1, Number.isFinite(declaredMax) && declaredMax > 0 ? declaredMax : 40))
  const context = Math.min(3, Math.max(0, Number(opts.context) || 0))
  const caseSensitive = opts.case_sensitive === true
  const matcher = compilePattern(rawPattern, caseSensitive)
  const root = resolveServerPath(inputPath || '', scopeRoot)
  let pathFilter = null
  if (typeof opts.glob === 'string' && opts.glob.trim()) {
    const filter = opts.glob.trim().replace(/\\/g, '/').replace(/^\.\//, '')
    if (hasGlobMagic(filter)) {
      const filterSegments = filter.split('/').filter(Boolean)
      pathFilter = new RegExp(`^${filterSegments.map(globSegmentToRegExp).join('/')}$`, 'i')
    } else {
      pathFilter = new RegExp(`^${escapeRegExp(filter)}$`, 'i')
    }
  }
  const matches = []
  let bytesScanned = 0
  let truncated = false
  let visited = 0

  async function searchFile(filePath) {
    if (bytesScanned >= MAX_SEARCH_SCAN_BYTES) {
      truncated = true
      return
    }
    const fileStat = await stat(filePath)
    if (!fileStat.isFile() || fileStat.size > 512 * 1024 || fileStat.size === 0) return
    if (pathFilter && !pathFilter.test(filePath.slice(root.length + 1).replace(/\\/g, '/'))) return
    const remaining = MAX_SEARCH_SCAN_BYTES - bytesScanned
    const readSize = Math.min(fileStat.size, remaining)
    bytesScanned += readSize
    if (bytesScanned >= MAX_SEARCH_SCAN_BYTES) truncated = true
    const { content } = await readTextFile(filePath, readSize)
    if (content.includes('\u0000')) return
    const lines = content.split('\n')
    let found = 0
    let lastEmitted = -1
    for (let index = 0; index < lines.length && found < maxResults; index++) {
      if (!matcher.test(lines[index])) continue
      found++
      const from = Math.max(0, index - context, lastEmitted + 1)
      const to = Math.min(lines.length - 1, index + context)
      for (let emitIndex = from; emitIndex <= to; emitIndex++) {
        matches.push({
          path: filePath,
          lineNumber: emitIndex + 1,
          line: lines[emitIndex].slice(0, 220),
          match: emitIndex === index
        })
      }
      lastEmitted = to
    }
  }

  async function walk(dir, depth) {
    if (depth > 8 || matches.length >= maxResults || bytesScanned >= MAX_SEARCH_SCAN_BYTES) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (matches.length >= maxResults || bytesScanned >= MAX_SEARCH_SCAN_BYTES) return
      visited++
      if (visited % 12 === 0) await yieldLoop()
      const full = resolve(dir, entry.name)
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) await walk(full, depth + 1)
      } else if (entry.isFile()) {
        await searchFile(full)
      }
    }
  }

  await walk(root, 0)
  const matchCount = matches.reduce((total, entry) => total + (entry.match !== false ? 1 : 0), 0)
  return { root, matches, count: matchCount, truncated }
}
