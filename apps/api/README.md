# ExitcodeAgent API

Node.js 内置 `node:http` 实现的单进程服务，无第三方依赖，负责：

- 唯一账号的首次创建、口令解锁和锁定
- 项目、会话、模型密钥的加密落盘（PBKDF2 + AES-GCM）
- 服务器文件系统目录浏览
- 模型请求的服务器端转发（Claude / OpenAI 兼容 / Ollama）
- 生产模式下托管 `apps/web/dist` 静态文件

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/state` | 是否已有账号、当前是否有解锁会话 |
| `POST` | `/api/setup` | 首次创建账号，返回会话令牌与初始数据 |
| `POST` | `/api/unlock` | 口令解锁，返回会话令牌与加密数据 |
| `POST` | `/api/lock` | 清除当前会话令牌 |
| `GET` | `/api/vault` | 读取当前服务器数据（需令牌） |
| `PUT` | `/api/vault` | 保存当前服务器数据（需令牌） |
| `POST` | `/api/workspace/list` | 浏览服务器目录（需令牌） |
| `POST` | `/api/model/stream` | 流式转发模型请求（需令牌） |
| `POST` | `/api/model/test` | 测试模型连接（需令牌） |

会话令牌放在 `Authorization: Bearer <token>` 请求头中，只保存在服务器内存。

## 配置

- `PORT`：默认 `8787`
- `HOST`：默认 `0.0.0.0`
- `EXITCODE_DATA_DIR`：加密数据文件目录，默认 `apps/api/data`
- `EXITCODE_WORKSPACE_ROOT`：服务器工作区根目录；设置后目录浏览不能越出该目录
- 生产静态目录固定为 `../web/dist`（相对 `apps/api/src`）
