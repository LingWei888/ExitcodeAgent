import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR } from './vault.mjs'

// 登录防爆破：
// - 每 IP/设备 2 小时窗口内最多 EXITCODE_MAX_LOGIN_PER_IP 次失败（内存态，重启清零窗口）
// - 全部累计失败超过 EXITCODE_MAX_LOGIN_TOTAL 后锁定账号（持久化，任何人均无法登录；
//   重置方式：删除 data/lock.json）
const LOGIN_WINDOW_MS = Number(process.env.EXITCODE_LOGIN_WINDOW_MS || 2 * 60 * 60 * 1000)
const MAX_LOGIN_PER_IP = Number(process.env.EXITCODE_MAX_LOGIN_PER_IP || 5)
const MAX_LOGIN_TOTAL = Number(process.env.EXITCODE_MAX_LOGIN_TOTAL || 20)

const LOCK_FILE = join(DATA_DIR, 'lock.json')

// ——— 每 IP 失败窗口（内存） ———
const ipFailuresMap = new Map()

export function ipFailures(ip) {
  if (!ip) return 0
  const w = ipFailuresMap.get(ip)
  if (!w) return 0
  if (Date.now() - w.firstAt > LOGIN_WINDOW_MS) {
    ipFailuresMap.delete(ip)
    return 0
  }
  return w.count
}

export function recordIpFailure(ip) {
  if (!ip) return ipFailures(ip)
  const now = Date.now()
  const w = ipFailuresMap.get(ip)
  if (w && now - w.firstAt <= LOGIN_WINDOW_MS) w.count++
  else ipFailuresMap.set(ip, { firstAt: now, count: 1 })
  return ipFailures(ip)
}

export function isIpBlocked(ip) {
  return ipFailures(ip) >= MAX_LOGIN_PER_IP
}

export function ipBlockWaitMs(ip) {
  const w = ipFailuresMap.get(ip)
  if (!w) return 0
  return Math.max(0, w.firstAt + LOGIN_WINDOW_MS - Date.now())
}

// ——— 账号锁定（持久化，未加密元文件，便于运维重置） ———
let lockData = {}
try {
  lockData = JSON.parse(readFileSync(LOCK_FILE, 'utf8')) || {}
} catch {
  lockData = {}
}

function saveLock() {
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(LOCK_FILE, JSON.stringify(lockData, null, 2))
  } catch {
    // 持久化失败不阻塞；锁仍在内存中生效
  }
}

export function isAccountLocked() {
  return Boolean(lockData.lockedAt)
}

export function totalLoginFailures() {
  return lockData.total || 0
}

// 记录一次失败；返回是否刚刚触发账号锁定
export function recordTotalFailure() {
  lockData.total = (lockData.total || 0) + 1
  const lockedNow = lockData.total >= MAX_LOGIN_TOTAL
  if (lockedNow) lockData.lockedAt = Date.now()
  saveLock()
  return lockedNow
}