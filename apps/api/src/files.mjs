import { readdir, stat } from 'node:fs/promises'
import os from 'node:os'
import { dirname, resolve, sep } from 'node:path'

const workspaceRoot = process.env.EXITCODE_WORKSPACE_ROOT ? resolve(process.env.EXITCODE_WORKSPACE_ROOT) : null

export function resolveServerPath(inputPath) {
  const requested = typeof inputPath === 'string' && inputPath.trim() ? inputPath.trim() : ''
  const target = requested ? resolve(requested) : workspaceRoot || os.homedir()
  if (workspaceRoot) {
    const root = resolve(workspaceRoot)
    if (target !== root && !target.startsWith(root + sep)) {
      throw new Error(`路径不在允许的工作区范围内：${workspaceRoot}`)
    }
  }
  return target
}

export async function listServerDirectory(inputPath) {
  const target = resolveServerPath(inputPath)
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
