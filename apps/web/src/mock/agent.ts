import type { ToolCall, ToolKind } from '../types'
import { appendUserMessage, createAssistantMessage, currentSession } from '../store'

interface ToolStep {
  kind: ToolKind
  title: string
  command: string
  output: string
  durationMs: number
}

interface Script {
  thinking: string
  tools: ToolStep[]
  reply: string
  files: { path: string; kind: 'modified' | 'created' | 'deleted'; summary: string }[]
}

const pendingRuns = new Map<string, number[]>()

const scripts: Record<string, Script> = {
  readme: {
    thinking:
      '用户想让我看一下 README 并说明当前结构。我先读文件、列目录，然后基于 monorepo 规划给出下一步建议。',
    tools: [
      {
        kind: 'read_file',
        title: '读取 README.md',
        command: 'sed -n "1,60p" README.md',
        output: '# ExitcodeAgent\n> 一个部署在自有服务器上的智能体协作平台\n## 功能特性\n- 网页对话即入口\n- 智能体代码能力\n- Docker 沙箱隔离',
        durationMs: 700
      },
      {
        kind: 'list_files',
        title: '查看项目根目录',
        command: 'ls -la',
        output: 'drwxr-xr-x  .idea/\n-rw-r--r--  .gitignore\n-rw-r--r--  README.md',
        durationMs: 500
      },
      {
        kind: 'execute_command',
        title: '检查工具链版本',
        command: 'node -v && pnpm -v && git --version',
        output: 'v24.14.0\n11.25.0\ngit version 2.42.0.windows.2',
        durationMs: 900
      }
    ],
    reply:
      '看完了。README 把架构规划得很清楚：浏览器 → API → 隔离沙箱，前端用 Vue 3 + Vite。当前阶段做前端界面，我就把 `apps/web` 搭起来，`apps/api` 先占位，后续接 NestJS 和 PostgreSQL 时直接填进去。',
    files: [
      { path: 'apps/web/src', kind: 'created', summary: 'Vue 3 + Vite 前端脚手架' },
      { path: 'apps/api/README.md', kind: 'created', summary: '后端目录占位说明' }
    ]
  },
  build: {
    thinking:
      '用户提到构建或运行问题。我按顺序检查依赖、运行类型检查，然后扫描最近变更，把失败点定位出来。',
    tools: [
      {
        kind: 'execute_command',
        title: '安装依赖',
        command: 'pnpm install',
        output: 'Lockfile is up to date, resolution step is skipped\nPackages: +208\nDone in 3.4s',
        durationMs: 1400
      },
      {
        kind: 'execute_command',
        title: '运行构建检查',
        command: 'pnpm --filter @exitcode/web build',
        output: 'vue-tsc -b && vite build\n✓ 48 modules transformed\ndist/index.html  0.48 kB │ gzip: 0.31 kB\n✓ built in 1.8s',
        durationMs: 1800
      },
      {
        kind: 'grep',
        title: '搜索遗留 TODO',
        command: 'rg -n "TODO|FIXME" apps/web/src',
        output: 'apps/web/src/mock/agent.ts:91: // TODO: 接入真实模型适配层',
        durationMs: 700
      }
    ],
    reply:
      '构建本身通过了，只剩一处占位 TODO 在 mock 智能体引擎里，属于后端接入前的预期标记。前端原型现在可以直接 `pnpm dev` 跑起来。',
    files: [
      { path: 'apps/web/dist', kind: 'created', summary: '前端构建产物' }
    ]
  },
  default: {
    thinking:
      '这是一次常规代练请求。我先摸清项目当前状态，再针对用户关心的部分做最小改动，并跑一遍验证。',
    tools: [
      {
        kind: 'git_status',
        title: '查看工作区状态',
        command: 'git status --short',
        output: '?? apps/\n?? pnpm-workspace.yaml',
        durationMs: 600
      },
      {
        kind: 'read_file',
        title: '读取关键文件',
        command: 'cat apps/web/src/store.ts',
        output: 'export const store = reactive({\n  authed: false,\n  projects: demoProjects,\n  ...\n})',
        durationMs: 900
      },
      {
        kind: 'execute_command',
        title: '跑类型检查',
        command: 'pnpm --filter @exitcode/web exec vue-tsc --noEmit',
        output: 'error TS2304: Cannot find name \'agent\'.\n  apps/web/src/mock/agent.ts:3:1',
        durationMs: 1300
      },
      {
        kind: 'write_file',
        title: '修正导入',
        command: '应用缺失 import',
        output: '已修正 apps/web/src/mock/agent.ts 的导入语句',
        durationMs: 900
      }
    ],
    reply:
      '改完了。工作区状态确认过，缺失的导入补上后类型检查通过。改动集中在 mock 智能体引擎里，没有碰到其他模块。',
    files: [
      { path: 'apps/web/src/mock/agent.ts', kind: 'modified', summary: '补齐缺失导入' }
    ]
  }
}

function pickScript(text: string): Script {
  if (/README|文档|readme/.test(text)) return scripts.readme
  if (/构建|构建失败|build|打包|报错/.test(text)) return scripts.build
  return scripts.default
}

export function runAgentReply(userText: string): void {
  appendUserMessage(userText)
  const script = pickScript(userText)
  const tools: ToolCall[] = script.tools.map((step, index) => ({
    id: `rt-${Date.now()}-${index}`,
    kind: step.kind,
    title: step.title,
    command: step.command,
    output: '',
    state: 'pending'
  }))
  const message = createAssistantMessage(script.thinking, tools)
  const timers: number[] = []

  let elapsed = 350
  tools.forEach((tool, index) => {
    const step = script.tools[index]
    timers.push(window.setTimeout(() => {
      tool.state = 'running'
    }, elapsed))
    elapsed += step.durationMs
    timers.push(window.setTimeout(() => {
      tool.state = 'done'
      tool.output = step.output
    }, elapsed))
    elapsed += 260
  })

  const fullReply = script.reply
  timers.push(window.setTimeout(() => {
    let cursor = 0
    message.status = 'streaming'
    const ticker = window.setInterval(() => {
      cursor += 3
      message.content = fullReply.slice(0, cursor)
      if (cursor >= fullReply.length) {
        window.clearInterval(ticker)
        message.content = fullReply
        message.status = 'done'

        const session = currentSession()
        session.runTokens.input += 300 + script.tools.length * 210
        session.runTokens.output += Math.round(fullReply.length / 3)
        session.filesChanged.unshift(...script.files)
        pendingRuns.delete(message.id)
      }
    }, 26)
    timers.push(ticker)
  }, elapsed))

  pendingRuns.set(message.id, timers)
}

export function stopAgentReply(messageId: string): void {
  const timers = pendingRuns.get(messageId)
  if (!timers) return
  timers.forEach((timer) => window.clearTimeout(timer))
  window.clearInterval(timers[timers.length - 1])
  pendingRuns.delete(messageId)

  const session = currentSession()
  const message = session.messages.find((item) => item.id === messageId)
  if (!message) return
  message.content = message.content || '任务已由你手动停止。'
  message.status = 'done'
}

export function isAgentRunning(): boolean {
  return pendingRuns.size > 0
}
