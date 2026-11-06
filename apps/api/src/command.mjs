import { spawn } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const COMMAND_TIMEOUT_MS = Number(process.env.EXITCODE_COMMAND_TIMEOUT_MS || 180_000)
const MAX_OUTPUT_BYTES = 64 * 1024
const KILL_GRACE_MS = 3000
const EXIT_GRACE_MS = 1500

// 抑制 ANSI 颜色并尽量让子进程输出 UTF-8（Windows cmd 内建命令仍可能输出 GBK）
const COMMAND_ENV = {
  NO_COLOR: '1',
  FORCE_COLOR: '0',
  PYTHONUTF8: '1',
  PYTHONIOENCODING: 'utf-8',
  LANG: 'en_US.UTF-8',
  LC_ALL: 'en_US.UTF-8'
}

function decodeOutput(buf) {
  const text = new TextDecoder('utf-8').decode(buf)
  const bad = (text.match(/�/g) ?? []).length
  const hint =
    text.length && bad / text.length > 0.02
      ? '\n\n（输出疑似非 UTF-8（GBK 等）已乱码；可在命令前加 `chcp 65001 >NUL &` 重试）'
      : ''
  return text + hint
}

function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    try {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      })
      killer.unref()
    } catch {
      // 杀进程失败不阻塞返回
    }
  } else {
    try {
      // detached: true 让子进程成为进程组首，负 pid 杀掉整棵树
      process.kill(-child.pid, 'SIGTERM')
      const kill9 = setTimeout(() => {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {
          // 进程已退出
        }
      }, KILL_GRACE_MS)
      kill9.unref()
    } catch {
      // 进程可能已退出
    }
  }
}

function sanitizeName(text) {
  return String(text || 'cmd').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 40) || 'cmd'
}

// 后台模式：detached 常驻，输出写日志文件，返回 PID、日志路径与启动初期输出片段
const BACKGROUND_TAIL_WAIT_MS = 3000
const BACKGROUND_TAIL_MAX = 1600

function readLogTail(file) {
  let fd = null
  try {
    const fileStat = statSync(file)
    if (!fileStat || fileStat.size === 0) return ''
    const size = Math.min(fileStat.size, BACKGROUND_TAIL_MAX)
    fd = openSync(file, 'r')
    const buf = Buffer.alloc(size)
    const { bytesRead } = readSync(fd, buf, 0, size, Math.max(0, fileStat.size - size))
    return decodeOutput(buf.subarray(0, bytesRead))
  } catch {
    return ''
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd)
      } catch {
        // 已关闭
      }
    }
  }
}

function runBackground(command, cwd, resolve) {
  const logDir = join(cwd, '.exitcode', 'logs')
  const logPath = join(logDir, `${sanitizeName(command)}-${Date.now()}.log`)
  try {
    mkdirSync(logDir, { recursive: true })
  } catch (error) {
    resolve({ ok: false, exitCode: null, output: `后台启动失败：无法创建日志目录 ${error.message}` })
    return
  }
  let logFd
  try {
    logFd = openSync(logPath, 'a')
  } catch {
    resolve({ ok: false, exitCode: null, output: `后台启动失败：无法打开日志文件 ${logPath}` })
    return
  }
  let fdClosed = false
  const closeFd = () => {
    if (fdClosed) return
    fdClosed = true
    try {
      closeSync(logFd)
    } catch {
      // 已关闭
    }
  }
  const child = spawn(command, {
    shell: true,
    cwd,
    env: { ...process.env, ...COMMAND_ENV },
    // Windows 上 detached 会丢弃字进程继承的输出句柄（输出全部丢失），且 Windows 下子进程在父进程退出后本就存活，因此仅 POSIX 需要 detached
    detached: process.platform !== 'win32',
    stdio: ['ignore', logFd, logFd],
    windowsHide: true
  })
  // 启动后轮询日志：dev server 等常驻命令可能在数秒内打印出网址/端口
  const poll = setInterval(() => {
    const tail = readLogTail(logPath)
    if (tail) {
      clearInterval(poll)
      settle(tail)
    }
  }, 500)
  const pollTimer = setTimeout(() => {
    clearInterval(poll)
    settle(readLogTail(logPath))
  }, BACKGROUND_TAIL_WAIT_MS)
  pollTimer.unref?.()

  let done = false
  const settle = (tail) => {
    if (done) return
    done = true
    clearTimeout(pollTimer)
    const tailBlock = tail.trim()
      ? `\n\n启动初期输出：\n${tail.trim().slice(0, BACKGROUND_TAIL_MAX)}`
      : ''
    const note =
      '（日志可能在几秒后继续写入，完整内容可用「读取文件」打开日志查看；进程仍在运行不代表失败）'
    resolve({
      ok: true,
      exitCode: null,
      background: true,
      pid: child.pid,
      logPath,
      output: `已在后台启动（PID ${child.pid}），输出写入日志：${logPath}${tailBlock}\n${note}\n需要停止时可用「执行命令」运行 taskkill /PID ${child.pid} /T /F（Windows）或 kill -TERM -${child.pid}（类 Unix）。`
    })
  }

  child.on('spawn', () => {
    try {
      child.unref()
    } catch {
      // 已 spawn 失败
    }
  })
  child.on('error', (error) => {
    clearInterval(poll)
    clearTimeout(pollTimer)
    closeFd()
    resolve({ ok: false, exitCode: null, output: `后台启动失败：${error.message}` })
  })
  child.on('exit', (code) => {
    try {
      writeFileSync(logPath, `\n[进程已退出，退出码 ${code ?? '未知'}]\n`, { flag: 'a' })
    } catch {
      // 日志写入失败不影响返回
    }
    closeFd()
    clearInterval(poll)
    clearTimeout(pollTimer)
    if (!done) settle(readLogTail(logPath))
  })
}

// 执行一条经过用户批准的命令；永不抛出，超时/中断/后台模式都转为明确的返回
export function runCommand(command, { cwd, signal, background = false } = {}) {
  if (background) {
    return new Promise((resolve) => runBackground(command, cwd ?? process.cwd(), resolve))
  }

  return new Promise((resolve) => {
    // Windows 上 detached + shell 会丢失子进程管道输出，因此仅 POSIX 用 detached 建立进程组
    const detached = process.platform !== 'win32'
    const child = spawn(command, {
      shell: true,
      cwd: cwd ?? process.cwd(),
      env: { ...process.env, ...COMMAND_ENV },
      detached,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let settled = false
    let truncated = false
    let timedOut = false
    let exitTimer = null
    const chunks = []
    let totalBytes = 0

    const push = (chunk) => {
      if (totalBytes >= MAX_OUTPUT_BYTES) return
      chunks.push(chunk)
      totalBytes += chunk.length
      if (totalBytes > MAX_OUTPUT_BYTES) truncated = true
    }

    const onAbort = () => killTree(child)

    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
    }, COMMAND_TIMEOUT_MS)
    timer.unref?.()

    signal?.addEventListener('abort', onAbort, { once: true })

    const finish = (kind) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (exitTimer) clearTimeout(exitTimer)
      signal?.removeEventListener('abort', onAbort)
      const code = child.exitCode ?? null
      if (kind === 'timedOut') {
        resolve({
          ok: false,
          exitCode: code,
          timedOut: true,
          truncated,
          output:
            `命令运行超过 ${Math.round(COMMAND_TIMEOUT_MS / 1000)} 秒未结束，已被终止（进程树一并结束）。` +
            '如果这是开发服务器/打包监听等常驻命令，请改用 execute_command 并设置 background:true 在后台启动，避免启动后被超时终止。'
        })
      } else if (kind === 'spawnError') {
        resolve({ ok: false, exitCode: null, output: '命令无法启动。' })
      } else {
        const output = decodeOutput(Buffer.concat(chunks))
        const abortNote = signal?.aborted ? '\n\n（运行被中断）' : ''
        resolve({ ok: code === 0 && !abortNote, exitCode: code, truncated, output: output + abortNote })
      }
    }

    child.stdout?.on('data', push)
    child.stderr?.on('data', push)
    child.on('error', () => finish('spawnError'))
    child.on('close', (code) => finish(timedOut ? 'timedOut' : code === null ? 'closed' : 'closed'))
    child.on('exit', (code) => {
      // 进程已退出，但 stdout/stderr 管道可能仍被子进程的后代持有（如 start /b 常驻命令），
      // 等一小段宽限后按现有输出结算，避免永远挂在 close 上
      if (settled) return
      exitTimer = setTimeout(() => {
        try {
          child.stdout?.destroy?.()
          child.stderr?.destroy?.()
        } catch {
          // 忽略
        }
        finish('closed')
      }, EXIT_GRACE_MS)
      exitTimer.unref?.()
    })
  })
}