import { mkdir, open, readdir, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { dirname, resolve, sep } from 'node:path'

const workspaceRoot = process.env.EXITCODE_WORKSPACE_ROOT ? resolve(process.env.EXITCODE_WORKSPACE_ROOT) : null
const MAX_TOOL_READ_BYTES = 256 * 1024
const IGNORED_DIRS = new Set(['.git', '.svn', '.hg', 'node_modules', 'dist', 'build', 'coverage', '.cache', '.next', '.venv', 'vendor', 'tmp', '.tmp'])

function isInside(root, target) {
  return target === root || target.startsWith(root + sep)
}

export function resolveServerPath(inputPath, scopeRoot) {
  const requested = typeof inputPath === 'string' && inputPath.trim() ? inputPath.trim() : ''
  const scope = scopeRoot ? resolve(scopeRoot) : null
  const target = requested ? resolve(requested) : scope || workspaceRoot || os.homedir()
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

export async function readServerFile(inputPath, scopeRoot, maxBytes = MAX_TOOL_READ_BYTES) {
  const target = resolveServerPath(inputPath, scopeRoot)
  const fileStat = await stat(target)
  if (!fileStat.isFile()) throw new Error('目标不是文件。')
  const { content, truncated } = await readTextFile(target, maxBytes)
  if (content.includes('\u0000')) throw new Error('二进制文件不支持直接读取。')
  return { path: target, content, size: fileStat.size, truncated }
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

function compilePattern(rawPattern) {
  const pattern = String(rawPattern || '').trim()
  if (!pattern) throw new Error('搜索关键词不能为空。')
  try {
    const regex = new RegExp(pattern, 'i')
    return { test: (line) => regex.test(line) }
  } catch {
    const needle = pattern.toLowerCase()
    return { test: (line) => line.toLowerCase().includes(needle) }
  }
}

export async function searchServerFiles(inputPath, rawPattern, scopeRoot, maxResults = 40) {
  const root = resolveServerPath(inputPath || '', scopeRoot)
  const matcher = compilePattern(rawPattern)
  const matches = []

  async function searchFile(filePath) {
    const fileStat = await stat(filePath)
    if (!fileStat.isFile() || fileStat.size > 512 * 1024 || fileStat.size === 0) return
    const { content } = await readTextFile(filePath, 512 * 1024)
    if (content.includes('\u0000')) return
    const lines = content.split('\n')
    for (let index = 0; index < lines.length && matches.length < maxResults; index++) {
      if (matcher.test(lines[index])) {
        matches.push({ path: filePath, lineNumber: index + 1, line: lines[index].slice(0, 220) })
      }
    }
  }

  async function walk(dir, depth) {
    if (depth > 8 || matches.length >= maxResults) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (matches.length >= maxResults) return
      const full = resolve(dir, entry.name)
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) await walk(full, depth + 1)
      } else if (entry.isFile()) {
        await searchFile(full)
      }
    }
  }

  await walk(root, 0)
  return { root, matches, count: matches.length }
}
