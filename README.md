# ExitcodeAgent

> 一个部署在自有服务器上的智能体协作平台：通过网页与 AI 智能体对话，让它在一个**隔离的 Docker 沙箱**里操作文件、执行命令、搭建网站、修复 Bug——类似可以自托管、团队共用的 Cursor / Codex。

## 当前状态（纯前端业务版）

当前实现不需要后端，业务全部在浏览器内完成：

- **真实模型直连**：在“模型与密钥”中填写提供方、接口地址、API Key 与模型名，支持 Claude、OpenAI 兼容接口（DeepSeek、通义千问、GLM 等）与 Ollama；会话消息直接请求对应模型服务，支持流式输出、停止生成、连接测试与 Token 用量统计
- **本机持久化**：用户、项目、会话、消息与模型接入保存在浏览器 localStorage，刷新不丢失
- **项目与会话管理**：创建项目会话、保存历史、随时切换模型
- **示例历史**：首次打开内置示例会话，展示工具调用记录的展示形态；浏览器受安全限制无法真实执行文件读写与命令，该能力需要后续后端沙箱支持，`apps/api` 已预留

启动前端：

```bash
pnpm install
pnpm dev:web
```

浏览器打开 `http://localhost:5173`，登录页任意账号或直接进入演示工作台即可体验。在右上角“模型与密钥”中添加自己的模型接入，建议先点“测试连接”确认接口可用。

跨域说明：Claude 官方接口支持浏览器直连；OpenAI 兼容端点与 Ollama 是否允许跨域取决于服务端配置（Ollama 可设置 `OLLAMA_ORIGINS`）。密钥仅保存在当前浏览器，请勿在公用电脑上使用。

## 功能特性

- **网页对话即入口**：浏览器打开即可登录，创建项目、发起会话、发送消息，无需任何本地工具
- **智能体代码能力**：读写文件、搜索代码、执行命令（安装依赖、跑测试、git 操作），承担"搭建网站、修 Bug"这类多步任务
- **Docker 沙箱隔离**：每个会话一个独立容器，CPU / 内存 / 超时受限，命令全部在容器内执行，破坏范围可控
- **实时流式体验**：模型的思考过程、命令输出、文件变更实时推送到浏览器（SSE + WebSocket）
- **多模型适配**：Claude / OpenAI 兼容接口（DeepSeek、通义千问、GLM 等）/ Ollama 本地模型，一套接口可切换
- **多用户与团队**：账号注册登录、角色权限、项目级隔离、个人会话管理
- **自带模型密钥（BYOK）**：每个用户自填 API 地址与 Key，自由切换 Claude / OpenAI 兼容 / Ollama，密钥加密存储、仅自己可见
- **一键部署**：docker compose 拉起全套服务，自带 HTTPS 反代

## 架构总览

```
浏览器 (Vue 3)
   │   HTTPS
   ▼
nginx/caddy（反向代理，终止 TLS）
   │
   ▼
api（NestJS，TypeScript）
   ├── 认证 / 用户 / 团队 / 项目      → PostgreSQL（Prisma）
   ├── 会话与任务状态                 → Redis
   ├── 模型适配层 ModelAdapter
   │      ├── Anthropic
   │      ├── OpenAI 兼容（DeepSeek / Qwen / GLM / Moonshot …）
   │      └── Ollama
   ├── Agent 核心（工具调用循环）
   └── 沙箱管理器（dockerode → Docker API）
             │
             ▼
      沙箱容器（每会话独立，从 sandbox 镜像启动）
         ├── /workspace  ← 对应项目的持久化 volume
         ├── 工具执行：文件读写 / bash / git / 网络请求
         └── 资源限制：--cpus --memory --network，超时自动回收
```

## 一次任务的执行流程

1. 用户在网页选择项目，发送消息
2. API 把系统提示词、工具定义、会话历史交给 Agent 核心，由模型适配层发起流式请求
3. 模型返回思考与回复内容（SSE 实时推送浏览器），或请求调用某个工具
4. 工具在**当前会话的沙箱容器内**执行（读文件、写文件、跑命令、git 提交……），执行结果回传给模型
5. 循环直到任务完成，生成变更摘要与最终答复，浏览器侧展示本次对话的完整过程

## 核心设计

### 多模型适配层（packages/model-adapter）

统一接口 `ModelProvider`，只暴露 `stream(messages, tools, config)`：

- `anthropic`：使用 `@anthropic-ai/sdk`，Agent 能力最成熟
- `openai-compatible`：用 `openai` sdk 改 `baseURL`，一个实现覆盖 DeepSeek、通义千问（DashScope）、GLM、Moonshot、火山引擎等
- `ollama`：本地模型，数据不出服务器

模型注册表存放于数据库，管理后台可增删模型配置；每个团队/项目可指定默认模型，用户在会话中可切换。

### Agent 核心（packages/agent-core）

- 标准的工具调用循环（agent tool-use loop）
- 初始工具集：`read_file` / `write_file` / `list_files` / `grep` / `execute_command`（容器内执行）/ `git_*` / `web_fetch`
- 会话历史管理与上下文压缩、token 用量统计与上限控制
- 单会话串行、多会话并行的任务调度

### 沙箱隔离（apps/sandbox-image + 沙箱管理器）

- 基础镜像：`node:22` + git + curl + 常见构建工具（可扩展）
- 每**会话** = 一个容器；每**项目** = 一个持久化 volume 作为 `/workspace`，会话结束不丢项目文件
- 沙箱管理器通过 dockerode 驱动：create / exec / stop / 超时回收
- 资源限制：`--cpus`、`--memory`、网络访问控制、单条命令超时
- 可选"危险操作人工确认"：`rm -rf` 等破坏性命令先在网页弹确认，由用户点同意才执行

### 多用户与团队

- JWT 认证 + bcrypt 口令，角色：owner / admin / member
- 资源模型：**团队 → 项目 → 工作区（volume） → 会话**
- 项目级权限：谁能读写哪个项目；会话归属于具体用户
- 可配置配额：并发会话数、单模型/单用户用量上限

### 模型凭证与用量统计（BYOK：用户自带 Key）

- 每个用户在自己的"模型设置"页填写：提供方（Claude / OpenAI 兼容 / Ollama）、Base URL、API Key、模型名，会话时可自由切换
- API Key 使用 AES-256-GCM 加密存储（密钥来自服务端环境变量），绝不返回明文、不进日志、不进入模型上下文
- 平台不做充值计费：用户用自己的 Key 产生模型费用；平台只按用户/团队统计 token 用量与调用次数，供参考与限额管理
- 未配置任何模型密钥的用户，发起任务前会收到配置引导

### 安全设计

- Docker 沙箱是第一道隔离：即使网页暴露在公网被入侵，破坏也只在容器内
- Docker Socket 仅对 API 后端开放，不暴露给网页层或公网
- 全站 HTTPS（服务栈内置反代自动签发证书）
- 登录限流、口令强度校验、token 过期与刷新
- 敏感信息（API Key、口令）不落日志、不进入模型上下文，记录前脱敏

## 技术选型（建议初始选型，实现时最终确认）

| 层 | 选择 | 说明 |
|---|---|---|
| 前端 | Vue 3 + Vite | 已确认 |
| 后端 | NestJS（TypeScript） | 多用户产品级应用结构清晰，SSE 与 WebSocket 一等公民 |
| 存储 | PostgreSQL + Prisma | 用户/团队/项目/会话元数据 |
| 缓存与总线 | Redis | 会话状态、跨实例 pub/sub、限流 |
| 实时通信 | SSE / NDJSON 流式消息（MVP）；WebSocket 推送留待 V1 | |
| 沙箱 | Docker API（dockerode） | |
| 模型 SDK | `@anthropic-ai/sdk` + `openai` | |

## 目录结构（规划的 monorepo，尚未编码）

```
ExitcodeAgent/
├── apps/
│   ├── api/                  # NestJS 后端：认证、会话、Agent、沙箱
│   ├── web/                  # Vue 3 前端：登录、项目管理、对话界面
│   └── sandbox-image/        # 沙箱镜像 Dockerfile
├── packages/
│   ├── agent-core/           # Agent 循环、工具注册、提示词
│   ├── tool-defs/            # 工具定义（schema + 执行）
│   ├── model-adapter/        # anthropic / openai-compatible / ollama
│   └── shared/               # 共享类型、常量
├── docker-compose.yml
├── .env.example
└── README.md
```

## 部署

### 服务器要求

- CPU 2 核及以上、内存 4G 及以上（推荐 4C8G）
- Docker 24+、docker compose v2
- 一个域名（推荐）：内置反代自动申请 HTTPS 证书；纯内网部署可省略
- 若同时跑 Ollama 本地模型：需额外 GPU

### 快速开始

1. 复制 `.env.example` 为 `.env`，填写 `JWT_SECRET`（`CIPHER_KEY` 如留空则从 JWT_SECRET 派生）
2. 构建沙箱镜像：`docker build -t exitcode-sandbox apps/sandbox-image`
3. `docker compose up -d`（首次启动自动建库建表）
4. 浏览器访问，注册管理员账号并创建团队，然后到"模型设置"填入自己的 API 地址与 Key

服务编排：`web` / `api` / `postgres` / `redis` / `caddy`（反代），沙箱容器由 api 按会话动态创建。

### 关键环境变量（示例）

| 变量 | 说明 |
|---|---|
| `JWT_SECRET` | 登录 token 签名密钥，必填 |
| `DATABASE_URL` | 数据库连接串（Redis 预留后续版本） |
| `CIPHER_KEY` | 加密用户 API Key 的密钥（base64 编码 32 字节；留空由 JWT_SECRET 派生） |
| `ANTHROPIC_API_KEY` | Claude 模型 Key |
| `OPENAI_BASE_URL` / `OPENAI_API_KEY` | 任意 OpenAI 兼容端点（拿 DeepSeek/Qwen/GLM 填这里） |
| `OLLAMA_BASE_URL` | 本地 Ollama 地址 |
| `SANDBOX_IMAGE` / `SANDBOX_CPU` / `SANDBOX_MEM` / `SANDBOX_TIMEOUT` | 沙箱镜像与资源限制 |

## 本地开发

- `pnpm install`（pnpm workspace monorepo）
- `apps/api`：`pnpm dev`；`apps/web`：`pnpm dev`
- 沙箱镜像需在 `apps/sandbox-image` 单独 build；本地开发仍需本机 Docker

## Roadmap

- **MVP**：对话 + 文件读写 + 命令执行 + git 操作；单用户多会话；一个模型源跑通全链路
- **V1**：多用户/团队/权限、管理后台（模型配置、用户、配额）、变更 diff 视图、用量统计与限额、危险操作人工确认
- **V2**：沙箱内浏览器工具（直接预览搭好的网站）、MCP / 插件系统、模板市场、CI 集成、用量报表
- **远期**：多智能体协作、语音入口、SSO

## 许可

MIT（开源协议，已确认）
