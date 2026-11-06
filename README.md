# ExitcodeAgent

一个部署在自有服务器上的智能体工作台：账号、项目、会话、模型密钥和口令都由服务器加密保存，工作区目录直接读取服务器文件系统，模型请求也由服务器转发。前端只是访问这个服务器系统的界面。

## 运行架构

```
浏览器 (Vue 3)
   │  HTTP / SSE
   ▼
apps/api（Node.js 单进程服务）
   ├── 唯一账号：首次创建 + 口令解锁，没有注册入口
   ├── 加密数据：项目/会话/密钥统一存 data/vault.json（PBKDF2 + AES-GCM）
   ├── 服务器目录：浏览并选择服务器工作区，读取服务器文件列表
   ├── 模型转发：Claude / OpenAI 兼容 / Ollama 由服务器请求，前端不直接跨域
   └── 静态托管：生产模式直接提供 apps/web/dist
```

## 快速开始

前置：Node.js 20+ 和 pnpm。

开发模式：

```bash
pnpm install
pnpm dev
```

启动后：

- `/api` 服务：`http://localhost:8787`
- 前端开发服务：`http://localhost:5173`

生产运行：

```bash
pnpm build
pnpm start
```

`pnpm start` 默认监听 `http://0.0.0.0:8787`，首次访问打开创建账号页。建议部署时在前面放一个 HTTPS 反向代理，并把 `PORT`、`HOST` 按环境配置。

## 功能

- **唯一服务器账号**：服务器首次启动后只能创建一次账号，之后只有口令解锁，不存在注册入口。提权后的账号数据通过 PBKDF2 派生密钥 + AES-GCM 加密落盘。
- **真实服务器数据**：项目、会话、消息、模型接入、当前选择全部由服务器持久化，不依赖用户浏览器 cookie 或 localStorage。
- **服务器文件工作区**：项目中可浏览服务器目录并选择工作区路径，右侧状态面板显示服务器真实文件列表。可用 `EXITCODE_WORKSPACE_ROOT` 限制可访问范围。
- **文件 Agent**：聊天会按需在服务器工作区内列目录、读文件、写入文件和搜索代码，工具调用、diff 预览和本轮文件变更都会在界面里展示。
- **模型服务端转发**：模型请求由服务器发出，前端做流式展示，支持停止生成、连接测试、Token 统计，以及通过接口和密钥一键获取模型列表。
- **锁定与安全**：锁定账号会清除服务器内存会话，再次操作需重新输入口令。

## 环境变量

| 变量 | 说明 |
|---|---|
| `PORT` | API / 静态服务端口，默认 `8787` |
| `HOST` | 监听地址，默认 `0.0.0.0` |
| `EXITCODE_DATA_DIR` | 加密数据目录，默认 `apps/api/data` |
| `EXITCODE_WORKSPACE_ROOT` | 服务器工作区根目录；设置后目录浏览只能访问该目录内 |

## 目录结构

```
apps/
├── api/                  # Node.js 服务：账号、加密存储、目录、模型转发
└── web/                  # Vue 3 + Vite 前端
    └── src/
        ├── components/   # 侧栏、对话、状态面板、服务器目录选择
        ├── services/     # API 客户端、目录读取、模型流式
        ├── store.ts      # 工作台状态与服务器持久化调度
        └── views/        # 登录视图与工作区视图
```

## 当前边界

- 当前版本读取服务器目录文件列表；写入文件和执行命令需要后续加入工具执行接口。
- 模型转发依赖目标模型服务可达。Ollama 部署在同一服务器时可直接使用 `http://localhost:11434/v1`。
- 服务端会话令牌保存在浏览器内存，刷新页面后需要重新解锁。

## Roadmap

- 服务器命令执行与工作区 git 操作
- 会话内工具调用记录与文件变更摘录
- 数据导出与备份
- HTTPS 反向代理与部署脚本

## 许可

MIT

## 一键安装与在线更新（类似宝塔）

服务器只需 Node.js ≥ 20（缺失或过低时脚本会**询问后自动下载便携版 Node**，回车即同意；
可用 `NODE_ASSUME_YES=1` 跳过询问）。安装脚本会：检测环境 → 随机选择端口（20000-59999，避免被扫描）
→ 生成自签名证书（默认 HTTPS）→ 下载发布包并校验 SHA256 → 启动服务 → 打印访问地址。

Node 下载默认走国内镜像（npmmirror），失败自动回退 nodejs.org；内网/离线环境可把 Node 官方包放到
自己的站点后用 `NODE_MIRROR` 指定，例如 `NODE_MIRROR=https://exitcode.cn/node bash install.sh`。

**Linux（或 Windows Git Bash）：**

```bash
URL=https://exitcode.cn/install.sh && if [ -f /usr/bin/curl ];then curl -sSO "$URL";else wget -O install.sh "$URL";fi;bash install.sh
```

**Windows（原生 PowerShell）：**

```powershell
powershell -ExecutionPolicy Bypass -Command "Invoke-WebRequest https://exitcode.cn/install.ps1 -OutFile install.ps1; .\install.ps1"
```

**在线更新**（保留数据/配置/证书，仅替换程序并重启）：

```bash
bash install.sh update
powershell -ExecutionPolicy Bypass -File install.ps1 update
```

其他命令：`status` / `logs` / `stop` / `start`。

### 发布

```bash
pnpm build:web
node tools/build-release.mjs 0.1.0
```

把 `tools/release/` 下的 `exitcode-<版本>.tar.gz` 与 `version.json` 上传到
`https://exitcode.cn/releases/`；`deploy/install.sh`、`deploy/install.ps1` 上传到
`https://exitcode.cn/` 根目录（即 /install.sh、/install.ps1）。更新时只需上传新版本号的新包 + 新版
`version.json`，用户执行 `update` 即可平滑升级。可用 `BASE_URL` 环境变量指向自定义镜像地址。

## 服务器管理命令（exitcode）

安装脚本会生成 `exitcode` 命令（Linux 装到 /usr/local/bin；Windows Git Bash 装到 ~/bin），支持：

```bash
exitcode -v                 # 查看版本
exitcode help               # 帮助（含作者：零微，反馈 lwei10036@gmail.com）
exitcode start|stop|restart|status|logs|autostart on|off|update
exitcode changepw           # 修改登录口令（交互式输入新旧口令，改后所有会话失效）
```

开机自启动：Linux（systemd）安装即默认开启；Windows 写入用户登录启动项，可用
`exitcode autostart off` 关闭。端口为随机高端口，默认 HTTPS（自签名证书）。
