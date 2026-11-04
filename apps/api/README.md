# ExitcodeAgent API（待实现）

此目录预留给 NestJS 后端服务，当前阶段仅完成前端原型，后端尚未编码。

规划中的服务职责：

- 认证、用户、团队、项目、会话的元数据管理（PostgreSQL + Prisma）
- 会话状态与限流（Redis，预留）
- 模型适配层接入：Anthropic / OpenAI 兼容 / Ollama
- Agent 工具调用循环与沙箱管理器（dockerode → Docker API）
- 会话沙箱的创建、执行、超时回收

技术选型以根目录 `README.md` 的架构总览为准，后续实现时再落地具体代码。
