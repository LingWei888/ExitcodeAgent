import type { Project, Session, SavedKey } from '../types'

export const demoProjects: Project[] = [
  {
    id: 'p-exit',
    name: 'exit-code',
    description: '自托管智能体平台，前端原型',
    sessionIds: ['s-1', 's-2']
  },
  {
    id: 'p-docs',
    name: 'docs-site',
    description: '产品文档站点',
    sessionIds: ['s-3']
  }
]

export const demoSessions: Record<string, Session> = {
  's-1': {
    id: 's-1',
    title: '整理 README 并确认架构',
    updatedAt: '10:42',
    branch: 'feat/web-prototype',
    messages: [
      {
        id: 'm-1',
        role: 'user',
        content: '先看一下 README，帮我确认项目目录要怎么拆。',
        time: '10:41',
        tools: [],
        status: 'done'
      },
      {
        id: 'm-2',
        role: 'assistant',
        content:
          'README 里架构是明确的：`apps/web` 放 Vue 前端，`apps/api` 放 NestJS 后端，`packages/` 放模型适配和 Agent 核心。考虑到当前阶段只做前端界面，我先把 `apps/web` 跑起来，`apps/api` 预留目录，等后端开工时再填实现。这样后续直接在上面加 API 层，不会重复调整目录。',
        time: '10:41',
        thinking:
          '用户想先确认目录划分。README 已经给了 monorepo 规划，前端是 Vue 3 + Vite。当前仓库只有 README 和 .gitignore，所以需要新建脚手架。后端在这个阶段不需要真正实现，但要预留 apps/api 位置，保持一致。',
        tools: [
          {
            id: 't-1',
            kind: 'read_file',
            title: '读取 README.md',
            command: 'cat README.md',
            output: '# ExitcodeAgent\n> 一个部署在自有服务器上的智能体协作平台……\n## 架构总览\n浏览器 (Vue 3) → API (NestJS) → 沙箱容器',
            state: 'done'
          },
          {
            id: 't-2',
            kind: 'list_files',
            title: '查看项目根目录',
            command: 'ls -la',
            output: '.idea/  .gitignore  README.md',
            state: 'done'
          }
        ],
        status: 'done'
      }
    ],
    runTokens: { input: 1832, output: 415 },
    filesChanged: [
      { path: 'apps/web/src/store.ts', kind: 'created', summary: '前端状态管理' },
      { path: 'apps/web/src/mock/agent.ts', kind: 'created', summary: '模拟智能体引擎' }
    ]
  },
  's-2': {
    id: 's-2',
    title: '对话界面的工具调用展示',
    updatedAt: '昨天',
    branch: 'feat/web-prototype',
    messages: [],
    runTokens: { input: 0, output: 0 },
    filesChanged: []
  },
  's-3': {
    id: 's-3',
    title: '文档站点搜索优化',
    updatedAt: '周一',
    branch: 'main',
    messages: [],
    runTokens: { input: 0, output: 0 },
    filesChanged: []
  }
}

export const modelPresets = [
  { id: 'm-claude', provider: 'anthropic', label: 'Claude Sonnet', model: 'claude-sonnet-4' },
  { id: 'm-deepseek', provider: 'openai-compatible', label: 'DeepSeek V3', model: 'deepseek-chat' },
  { id: 'm-ollama', provider: 'ollama', label: 'Ollama 本地', model: 'qwen3:8b' }
] as const

export const savedKeys: SavedKey[] = [
  {
    id: 'k-1',
    provider: 'openai-compatible',
    label: 'DeepSeek 工作账号',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    maskedKey: 'sk-ds••••••••••••••••••4f2a'
  }
]
