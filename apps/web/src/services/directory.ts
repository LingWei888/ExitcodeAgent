import type { FileSystemDirectoryHandle } from '../types'

const DB_NAME = 'exitcode-directories'
const STORE_NAME = 'handles'

export interface DirectoryEntry {
  name: string
  kind: 'file' | 'directory'
  size?: number
}

interface PickerOptions {
  id?: string
  mode?: 'read' | 'readwrite'
  startIn?: string | FileSystemDirectoryHandle
}

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker: (options?: PickerOptions) => Promise<FileSystemDirectoryHandle>
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export function isDirectoryPickerSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

export async function pickProjectDirectory(): Promise<{ name: string; handle: FileSystemDirectoryHandle }> {
  if (!isDirectoryPickerSupported()) {
    throw new Error('当前浏览器不支持选择服务器目录。')
  }
  const options: PickerOptions = { mode: 'read', id: 'exitcode-project' }
  const handle = await (window as unknown as DirectoryPickerWindow).showDirectoryPicker(options)
  return { name: handle.name, handle }
}

export async function saveDirectoryHandle(projectId: string, handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(handle, projectId)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getDirectoryHandle(projectId: string): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const request = tx.objectStore(STORE_NAME).get(projectId)
    request.onsuccess = () => resolve((request.result as FileSystemDirectoryHandle | undefined) ?? null)
    request.onerror = () => reject(request.error)
  })
}

export async function ensureReadPermission(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
  const query = await handle.queryPermission({ mode: 'read' })
  if (query === 'granted') return 'granted'
  const request = await handle.requestPermission({ mode: 'read' })
  return request
}

export async function listDirectory(handle: FileSystemDirectoryHandle, limit = 40): Promise<DirectoryEntry[]> {
  const entries: DirectoryEntry[] = []
  for await (const [name, child] of handle.entries()) {
    if (entries.length >= limit) break
    if (child.kind === 'file') {
      const size = (await (child as FileSystemFileHandle).getFile()).size
      entries.push({ name, kind: 'file', size })
    } else {
      entries.push({ name, kind: 'directory' })
    }
  }
  return entries
}

export function formatSize(bytes?: number): string {
  if (bytes === undefined) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

