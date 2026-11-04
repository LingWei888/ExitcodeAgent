import type { Project, SavedKey, Session } from '../types'

const VAULT_KEY = 'exitcode.vault.v1'
const PBKDF2_ITERATIONS = 210_000

export interface VaultData {
  user: { name: string; email: string; createdAt: string }
  projects: Project[]
  sessions: Record<string, Session>
  savedKeys: SavedKey[]
  currentProjectId: string
  currentSessionId: string
  currentModelId: string
}

interface VaultRecord {
  version: 1
  salt: string
  iv: string
  payload: string
}

interface CryptoKeyResult {
  key: CryptoKey
  salt: Uint8Array
}

let activeKey: CryptoKey | null = null
let activeSalt: Uint8Array | null = null

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)))
  return btoa(binary)
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function deriveKeyResult(password: string, salt: Uint8Array): Promise<CryptoKeyResult> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
  return { key, salt }
}

async function encryptData(key: CryptoKey, data: string): Promise<{ iv: Uint8Array; payload: Uint8Array }> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(data)
  )
  return { iv, payload: new Uint8Array(encrypted) }
}

async function decryptData(key: CryptoKey, iv: Uint8Array, payload: Uint8Array): Promise<string> {
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    payload as BufferSource
  )
  return new TextDecoder().decode(decrypted)
}

function readRecord(): VaultRecord | null {
  const raw = localStorage.getItem(VAULT_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as VaultRecord
  } catch {
    localStorage.removeItem(VAULT_KEY)
    return null
  }
}

export async function hasLocalAccount(): Promise<boolean> {
  return Boolean(readRecord())
}

export async function createLocalAccount(data: VaultData, password: string): Promise<void> {
  const { key, salt } = await deriveKeyResult(password, crypto.getRandomValues(new Uint8Array(16)))
  const { iv, payload } = await encryptData(key, JSON.stringify(data))
  const record: VaultRecord = {
    version: 1,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    payload: bytesToBase64(payload)
  }
  localStorage.setItem(VAULT_KEY, JSON.stringify(record))
  activeKey = key
  activeSalt = salt
}

export async function unlockLocalAccount(password: string): Promise<VaultData> {
  const record = readRecord()
  if (!record) throw new Error('本机还没有账号，需要先完成首次设置。')
  try {
    const derived = await deriveKeyResult(password, base64ToBytes(record.salt))
    const plain = await decryptData(derived.key, base64ToBytes(record.iv), base64ToBytes(record.payload))
    const data = JSON.parse(plain) as VaultData
    if (!data.user || !Array.isArray(data.projects)) {
      throw new Error('本机数据损坏，无法解锁。')
    }
    activeKey = derived.key
    activeSalt = derived.salt
    return data
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('本机数据损坏，无法解锁。')
    throw new Error('口令不正确，请重试。')
  }
}

export async function saveVaultData(data: VaultData): Promise<void> {
  if (!activeKey || !activeSalt) {
    throw new Error('账号未解锁，数据未保存。')
  }
  const { iv, payload } = await encryptData(activeKey, JSON.stringify(data))
  const record: VaultRecord = {
    version: 1,
    salt: bytesToBase64(activeSalt),
    iv: bytesToBase64(iv),
    payload: bytesToBase64(payload)
  }
  localStorage.setItem(VAULT_KEY, JSON.stringify(record))
}

export function lockLocalAccount(): void {
  activeKey = null
  activeSalt = null
}

export function isVaultUnlocked(): boolean {
  return activeKey !== null
}