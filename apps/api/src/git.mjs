import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const GIT_TIMEOUT_MS = 15000

function runGit(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
      if (error) {
        const detail = String(error.message ?? '')
        if (/not a git repository/i.test(detail)) {
          reject(new Error('当前工作区不是 git 仓库，git 工具不可用；可先用 execute_command 执行 git init 初始化。'))
          return
        }
        reject(new Error(`git ${args[0] ?? ''} 失败：${String(error.message ?? '').split('\n')[0]}`))
        return
      }
      resolve(String(stdout ?? ''))
    })
  })
}

export async function gitStatus(cwd) {
  const branch = (await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)).trim()
  const porcelain = await runGit(['status', '--porcelain=v1', '-b'], cwd)
  const lines = porcelain.split('\n').filter(Boolean)
  const headMatch = /^##\s+(\S+)(?:\.\.\.(\S+))?(?: \[(.*?)\])?$/.exec(lines[0] ?? '')
  const head = headMatch ? `分支 ${headMatch[1]}${headMatch[3] ? `（${headMatch[3]}）` : ''}` : `分支 ${branch || '未知'}`
  return { branch, head, changes: lines.slice(1) }
}

// 生成 git_commit 的批准命令：提交信息写入工作区临时文件（git commit -F），避免跨 shell 转义问题。
// 默认 git add -u 只暂存已跟踪文件的改动/删除，绝不 git add -A——.exitcode/ 等运行产物不入库。
export function makeGitCommitCommand(args, root) {
  const message = typeof args?.message === 'string' ? args.message.trim() : ''
  if (!message) throw new Error('git_commit 缺少 message 参数，请提供提交说明。')
  const rawPaths = Array.isArray(args?.paths) ? args.paths.map((item) => String(item).trim()).filter(Boolean) : []
  const safePaths = rawPaths.map((path) => {
    const normalized = String(path).replace(/\\/g, '/')
    if (normalized.startsWith('/') || (normalized.includes('/') && normalized.split('/').includes('..')) || normalized === '..') {
      throw new Error(`git_commit 的 paths 只允许工作区内的相对路径：${path}`)
    }
    return normalized
  })
  const rand = randomBytes(6).toString('hex')
  const relative = `.exitcode/tmp/git-commit-msg-${rand}.txt`
  mkdirSync(join(root, '.exitcode', 'tmp'), { recursive: true })
  writeFileSync(join(root, relative), `${message}\n`, 'utf8')
  const stageTarget = safePaths.length ? safePaths.map((path) => `"${path}"`).join(' ') : '-u'
  const command = `git add ${stageTarget} && git commit -F ${relative}`
  return {
    command,
    cleanup: () => {
      try {
        unlinkSync(join(root, relative))
      } catch {
        // 临时提交信息文件删除失败不影响结果
      }
    }
  }
}