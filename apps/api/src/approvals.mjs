import { randomUUID } from 'node:crypto'

export const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000

// 运行中的待审批注册表：key 为全局唯一 approvalId，天然隔离并发 run
const pending = new Map()

// 登记一条待审批命令，返回 { id, promise }；id 用于前端审批，promise 在用户决断/超时/中断时结算
export function createApproval({ command, cwd, token, signal }) {
  let resolvePromise
  let rejectPromise
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })

  if (signal?.aborted) {
    rejectPromise(new Error('连接已中断，审批未受理。'))
    return { id: '', promise }
  }

  const id = randomUUID()
  const entry = { resolve: resolvePromise, reject: rejectPromise, timer: null, onAbort: null, signal, token }
  entry.timer = setTimeout(() => {
    if (pending.delete(id)) {
      if (entry.onAbort) signal?.removeEventListener('abort', entry.onAbort)
      entry.onAbort = null
      rejectPromise(new Error('审批超时，命令未执行。'))
    }
  }, APPROVAL_TIMEOUT_MS)
  entry.timer.unref?.()
  entry.onAbort = () => {
    if (pending.delete(id)) {
      clearTimeout(entry.timer)
      rejectPromise(new Error('连接已中断，审批未受理。'))
    }
    entry.onAbort = null
  }
  signal?.addEventListener('abort', entry.onAbort, { once: true })
  pending.set(id, entry)
  return { id, promise }
}

// 用户提交决议（同步）：找到并结算则返回 true，否则 false（已处理/不存在）
export function resolveApproval(id, approve) {
  const entry = pending.get(id)
  if (!entry) return false
  pending.delete(id)
  clearTimeout(entry.timer)
  if (entry.onAbort) entry.signal?.removeEventListener('abort', entry.onAbort)
  entry.onAbort = null
  if (approve) entry.resolve()
  else entry.reject(new Error('用户拒绝了命令。'))
  return true
}

export function isApprovalOwner(id, token) {
  return pending.get(id)?.token === token
}