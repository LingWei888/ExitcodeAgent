import { apiRequest } from './api'

export interface DirectoryEntry {
  name: string
  kind: 'file' | 'directory'
  size?: number
  path: string
}

export interface DirectoryListing {
  path: string
  parent: string | null
  entries: DirectoryEntry[]
}

export function isDirectoryPickerSupported(): boolean {
  return true
}

export async function listDirectory(path?: string): Promise<DirectoryListing> {
  return apiRequest<DirectoryListing>('/api/workspace/list', {
    method: 'POST',
    body: { path: path ?? '' }
  })
}

export function formatSize(bytes?: number): string {
  if (bytes === undefined) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
