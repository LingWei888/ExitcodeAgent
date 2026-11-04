import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFile } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const DATA_DIR = process.env.EXITCODE_DATA_DIR
  ? resolve(process.env.EXITCODE_DATA_DIR)
  : resolve(here, '..', 'data')
const VAULT_FILE = resolve(DATA_DIR, 'vault.json')
const PBKDF2_ITERATIONS = 210_000

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })

function deriveKey(password, salt) {
  return pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, 'sha256')
}

function encode(bytes) {
  return Buffer.from(bytes).toString('base64')
}

function decode(base64) {
  return Buffer.from(base64, 'base64')
}

function encryptRecord(key, data, saltValue = randomBytes(16)) {
  const salt = saltValue
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final(), cipher.getAuthTag()])
  return { version: 1, salt: encode(salt), iv: encode(iv), payload: encode(encrypted) }
}

function decryptRecord(key, record) {
  if (!record || record.version !== 1) throw new Error('服务器数据格式无效。')
  const iv = decode(record.iv)
  const payload = decode(record.payload)
  if (payload.length < 17 || iv.length !== 12) throw new Error('服务器数据已损坏。')
  const tag = payload.subarray(payload.length - 16)
  const body = payload.subarray(0, payload.length - 16)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8'))
}

function readRecord() {
  if (!existsSync(VAULT_FILE)) return null
  try {
    return JSON.parse(readFileSync(VAULT_FILE, 'utf8'))
  } catch {
    throw new Error('服务器加密数据损坏，请检查 data/vault.json。')
  }
}

let writeChain = Promise.resolve()

function enqueueWrite(record) {
  writeChain = writeChain.then(
    () =>
      new Promise((resolveWrite, rejectWrite) => {
        writeFile(VAULT_FILE, JSON.stringify(record, null, 2), (error) => {
          if (error) rejectWrite(error)
          else resolveWrite()
        })
      })
  )
  return writeChain
}

export function validateVaultData(data) {
  return (
    data &&
    typeof data === 'object' &&
    typeof data.user?.name === 'string' &&
    Array.isArray(data.projects) &&
    data.sessions &&
    typeof data.sessions === 'object' &&
    Array.isArray(data.savedKeys)
  )
}

const sessions = new Map()

function issueToken() {
  return randomBytes(32).toString('hex')
}

function createSessionFromPassword(record, password, data) {
  const token = issueToken()
  const key = deriveKey(password, decode(record.salt))
  sessions.set(token, { key, salt: decode(record.salt), data })
  return token
}

export function hasAccount() {
  return existsSync(VAULT_FILE)
}

export function unlockedCount() {
  return sessions.size
}

export async function setupAccount(data, password) {
  if (hasAccount()) throw new Error('服务器已经创建过账号。')
  if (!validateVaultData(data)) throw new Error('账号初始化数据无效。')
  const salt = randomBytes(16)
  const record = encryptRecord(deriveKey(password, salt), data, salt)
  await enqueueWrite(record)
  const token = createSessionFromPassword(record, password, data)
  return { token, data }
}

export async function unlockAccount(password) {
  const record = readRecord()
  if (!record) throw new Error('服务器还没有账号，需要先完成首次设置。')
  let data
  try {
    data = decryptRecord(deriveKey(password, decode(record.salt)), record)
  } catch {
    throw new Error('口令不正确，请重试。')
  }
  if (!validateVaultData(data)) throw new Error('服务器数据损坏，无法解锁。')
  const token = createSessionFromPassword(record, password, data)
  return { token, data }
}

export function touchSession(token) {
  return sessions.get(token) ?? null
}

export function lockSession(token) {
  sessions.delete(token)
}

export async function saveSessionData(token, data) {
  const session = sessions.get(token)
  if (!session) throw new Error('账号已锁定，请重新解锁。')
  if (!validateVaultData(data)) throw new Error('保存的数据格式无效。')
  return enqueueWrite(encryptRecord(session.key, data, session.salt))
}

