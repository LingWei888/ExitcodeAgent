import { resolve, sep } from 'node:path'
import {
  listServerDirectory,
  readServerFile,
  resolveServerPath,
  searchServerFiles,
  writeServerFile
} from './files.mjs'
import { anthropicUrl, stripSlash, upstreamError, validateConnection } from './model.mjs'
import { runCommand } from './command.mjs'
import { APPROVAL_TIMEOUT_MS, createApproval } from './approvals.mjs'

const TOOL_LABELS = {
  list_files: '列出目录',
  read_file: '读取文件',
  write_file: '写入文件',
  grep: '搜索代码',
  delegate_task: '子任务',
  execute_command: '执行命令'
}

const TOOL_DEFS = [
  {
    name: 'list_files',
    description: '列出服务器工作区中指定目录的内容。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '目录路径，相对于工作区，留空表示工作区根目录' }
      }
    }
  },
  {
    name: 'read_file',
    description: '读取服务器工作区中某个文本文件的内容。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径，相对于工作区' }
      },
      required: ['path']
    }
  },
  {
    name: 'write_file',
    description: '创建或覆盖写入服务器工作区中的文本文件，必要时自动创建父目录。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径，相对于工作区' },
        content: { type: 'string', description: '文件完整内容' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'grep',
    description: '在服务器工作区中按关键词或正则搜索文件内容。',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: '搜索关键词或正则表达式' },
        path: { type: 'string', description: '起始目录，相对于工作区' }
      },
      required: ['pattern']
    }
  },
  {
    name: 'delegate_task',
    description:
      '把一个相对独立、无依赖的子任务交给子代理并行处理（例如：修改某个独立文件、单独调研一段实现）。子代理有自己的执行循环，会独立调用工具，父任务不受阻塞。参数必须包含足够上下文：目标文件路径、期望结果、验收标准。',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: '子任务说明，要求具体到可独立执行（含明确路径与验收标准）' },
        rationale: { type: 'string', description: '为什么需要拆给子代理（简短说明）' }
      },
      required: ['task']
    }
  },
  {
    name: 'execute_command',
    description:
      '在服务器工作区的终端里执行一条 shell 命令（例如安装依赖、启动服务、运行测试）。执行前会请求用户批准，批准后才会真正运行。后台运行（background:true，适合 npm run dev 等常驻进程）会立即返回 PID、日志文件路径与启动初期输出，不受超时限制；启动后请用「读取文件」查看日志确认结果（日志可能延迟出现，等待数秒后重读）。命令对文件的改动不会纳入按轮回滚。',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要在终端执行的完整命令' },
        cwd: { type: 'string', description: '可选：执行目录，相对工作区，默认工作区根目录' },
        detail: { type: 'string', description: '可选：为什么执行这条命令（简要说明）' },
        background: {
          type: 'boolean',
          description: '可选：true 时在后台常驻运行并立即返回（适合 dev server 等不结束的进程），默认 false 等待命令结束'
        }
      },
      required: ['command']
    }
  }
]

const SYSTEM_PROMPT =
  '你是部署在服务器上的编码智能体。风格（重要）：像 Cursor 一样极度精简，输出最小化——不寒暄、不复述任务、不解释过程、不给代码贴标签，能短则短。' +
  '工具：列出目录、读取文件、写入文件、搜索代码、执行命令、派发子任务；路径一律基于工作区，动手前先读取相关文件，改动保持最小。' +
  '每步行动前最多用半句话说明或直接省略，不要解释你在做什么；可并行调用多个互不依赖的工具；写文件后可读取确认。' +
  '质量优先（重要）：精简只针对文字说明，绝不减少检查步骤——改前必读、改后必验、结果必看，必要的验证一个都不能省。' +
  '需要跑 shell 命令（安装依赖、启动服务、测试、查环境）时用 execute_command，命令需用户批准；' +
  '启动 npm run dev 这类常驻命令务必 background:true（后台启动后立刻用「读取文件」查看返回的日志路径确认；日志可能延迟几秒，等 2-3 秒重读最多 3 次，为空不代表失败，看到 Local:/端口/监听成功才算成功；不要用 start /b 等技巧）。' +
  '独立子任务用 delegate_task 交给子代理并行推进。' +
  '任务真正完成后才输出总结，最多 2-3 行要点式：改了什么 + 验证结果，如「新增 src/app.ts; npm run build 通过」；未完成前继续用工具推进，绝不提前总结。'

const PLAN_SYSTEM_HINT =
  '\n\n请先不要执行任何工具，也不要输出其它文字。请分析用户任务，输出一个执行计划，格式必须是合法的 JSON 数组，' +
  '每一项为 {"id":"p1","title":"≤10 字的中文动作描述"}，共 3-8 项，按依赖顺序排列，不要使用 markdown 代码块。'

const VERIFY_SYSTEM_HINT =
  '\n\n请严格检查你刚才的工作是否真正完成了用户请求：重新确认关键文件内容、验证改动正确性。' +
  '如果仍有必要操作（读取文件确认、写文件修正、搜索验证），请继续调用工具完成它们；' +
  '确认全部完成后才输出总结，最多 2 行要点：改了什么 + 验证结果。'

const COMPACT_SYSTEM_HINT =
  '\n\n请把下面这段历史对话压缩成精炼的中文摘要。保留：已修改的文件与改动要点、关键路径、当前进度、剩余未完成事项。' +
  '忽略寒暄与无关细节。只输出摘要正文，不要输出标题或其它内容。'

const COMPACT_THRESHOLD = 56000
const AUTOFIX_LIMIT = 2

const STEP_TIMEOUT_MS = 120000

const DEFAULT_MAX_STEPS = Number(process.env.EXITCODE_MAX_STEPS || 16)
const DELEGATE_MAX_STEPS = Number(process.env.EXITCODE_DELEGATE_MAX_STEPS || 10)

function workspacePath(workspace, inputPath) {
  const root = resolve(workspace)
  const requested = String(inputPath || '').trim()
  const target = requested ? resolve(root, requested) : root
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(`路径超出工作区：${requested || inputPath}`)
  }
  return target
}

function safeParse(raw) {
  if (raw && typeof raw === 'object') return raw
  if (typeof raw !== 'string') return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function parsePlan(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) text = fence[1].trim()
  let data = null
  try {
    data = JSON.parse(text)
  } catch {
    const open = text.indexOf('[')
    const close = text.lastIndexOf(']')
    if (open >= 0 && close > open) {
      try {
        data = JSON.parse(text.slice(open, close + 1))
      } catch {
        data = null
      }
    }
  }
  if (!Array.isArray(data) || !data.length) return null
  const items = data
    .filter((item) => item && typeof item.title === 'string' && item.title.trim())
    .slice(0, 12)
    .map((item, index) => ({ id: String(item.id || `p${index + 1}`), title: item.title.trim() }))
  return items.length ? items : null
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function describeToolCall(kind, args) {
  if (kind === 'grep') return args.pattern ? `grep: ${args.pattern}` : ''
  if (kind === 'delegate_task' && args.task) {
    const text = args.task.replace(/\s+/g, ' ').trim()
    return text.length > 48 ? `${text.slice(0, 48)}…` : text
  }
  if (kind === 'execute_command') {
    const text = typeof args.command === 'string' ? args.command.replace(/\s+/g, ' ').trim() : ''
    return text.length > 60 ? `${text.slice(0, 60)}…` : text
  }
  const path = args.path ?? ''
  return path
}

function truncateText(text, max = 24000) {
  if (typeof text !== 'string' || text.length <= max) return text ?? ''
  const head = Math.floor(max * 0.62)
  const tail = Math.max(200, max - head - 90)
  const omitted = text.length - head - tail
  return `${text.slice(0, head)}\n\n…（中间省略 ${omitted} 字符，共 ${text.length} 字符）\n\n${text.slice(-tail)}`
}

function estimateTokens(messages) {
  let total = 0
  for (const message of messages) {
    const text = typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? '')
    total += Math.ceil(text.length / 2.2)
  }
  return total
}

function pendingTool(id, name) {
  return {
    id: String(id),
    kind: name,
    title: TOOL_LABELS[name] ?? name,
    state: 'pending'
  }
}

// 并行执行一批任务并逐个结算：谁先完成谁先产出，避免慢任务拖住整批结果
export async function* eachSettled(tasks) {
  if (!tasks.length) return
  const pending = new Map(tasks.map((task, i) => [i, Promise.resolve().then(task)]))
  while (pending.size) {
    const [index, result] = await Promise.race(
      [...pending].map(([i, promise]) => promise.then((value) => [i, { value }], (error) => [i, { error }]))
    )
    pending.delete(index)
    yield { index, ...result }
  }
}

async function executeTool(kind, args, workspace) {
  switch (kind) {
    case 'list_files': {
      const target = workspacePath(workspace, args.path)
      const listing = await listServerDirectory(target, workspace)
      const lines = [`目录 ${listing.path}`]
      for (const entry of listing.entries) {
        if (entry.kind === 'directory') lines.push(`[目录] ${entry.name}`)
        else lines.push(`[文件] ${entry.name} (${formatBytes(entry.size ?? 0)})`)
      }
      return { ok: true, output: lines.join('\n') }
    }
    case 'read_file': {
      const target = workspacePath(workspace, args.path)
      const result = await readServerFile(target, workspace)
      const output = `文件 ${result.path}\n${result.content}${result.truncated ? '\n\n（内容过长，仅显示前 256KB）' : ''}`
      return { ok: true, output, path: result.path }
    }
    case 'write_file': {
      const target = workspacePath(workspace, args.path)
      const result = await writeServerFile(target, args.content, workspace)
      return {
        ok: true,
        output: `已写入 ${result.path}（${formatBytes(result.size)}）`,
        path: result.path,
        diff: result.diff,
        changeKind: result.kind,
        detail: result.kind === 'created' ? `新增 ${formatBytes(result.size)}` : `修改 ${formatBytes(result.size)}`
      }
    }
    case 'grep': {
      const target = workspacePath(workspace, args.path)
      const result = await searchServerFiles(target, args.pattern, workspace)
      if (!result.matches.length) {
        const note = result.truncated ? '（扫描达到上限，未发现更多内容）' : ''
        return { ok: true, output: `未找到匹配：${args.pattern}${note}` }
      }
      const lines = result.matches.map((match) => `${match.path}:${match.lineNumber}: ${match.line}`)
      const note = result.truncated ? '\n\n（已达到扫描上限，结果可能不完整）' : ''
      return { ok: true, output: `匹配 ${result.count} 处\n` + lines.join('\n') + note }
    }
    default:
      throw new Error(`不支持的工具：${kind}`)
  }
}

async function* sseEvents(response) {
  if (!response.body) return
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const frames = buffer.split('\n\n')
      buffer = frames.pop() ?? ''
      for (const frame of frames) {
        let data = ''
        for (const line of frame.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          data += (data ? '\n' : '') + trimmed.slice(5).trim()
        }
        if (!data || data === '[DONE]') continue
        try {
          yield JSON.parse(data)
        } catch {
          // Ignore keep-alive or malformed frames.
        }
      }
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // The reader may already be closed.
    }
  }
}

function isAborted(signal, controller) {
  return Boolean(signal?.aborted || controller?.signal.aborted)
}

async function* streamOpenAiTurn(upstream, signal, controller) {
  let text = ''
  let reasoned = false
  let inputTokens = 0
  let outputTokens = 0
  const toolSlots = new Map()
  let nextIndex = 0
  try {
    for await (const event of sseEvents(upstream)) {
      if (event?.error) throw new Error(event.error?.message || event.error || '模型接口返回错误。')
      for (const choice of Array.isArray(event.choices) ? event.choices : []) {
        const delta = choice?.delta ?? {}
        if (delta.reasoning_content) reasoned = true
        if (typeof delta.content === 'string' && delta.content) {
          text += delta.content
          yield { type: 'delta', text: delta.content }
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const part of delta.tool_calls) {
            const index = part.index ?? nextIndex++
            if (!toolSlots.has(index)) toolSlots.set(index, { id: '', name: '', args: '', announced: false, lastProgress: 0 })
            const slot = toolSlots.get(index)
            if (part.id) slot.id = part.id
            const fn = part.function ?? {}
            if (fn.name) slot.name += fn.name
            const grew = typeof fn.arguments === 'string' && fn.arguments.length > 0
            if (grew) slot.args += fn.arguments
            if (slot.id && slot.name) {
              if (!slot.announced) {
                slot.announced = true
                yield { type: 'tool_pending', tool: pendingTool(slot.id, slot.name) }
              }
              if (grew) {
                const now = Date.now()
                if (now - slot.lastProgress >= 120) {
                  slot.lastProgress = now
                  yield { type: 'tool_progress', toolId: slot.id, chars: slot.args.length }
                }
              }
            }
          }
        }
      }
      if (typeof event.usage?.prompt_tokens === 'number') inputTokens = event.usage.prompt_tokens
      if (typeof event.usage?.completion_tokens === 'number') outputTokens = event.usage.completion_tokens
    }
  } catch (error) {
    if (isAborted(signal, controller) || error?.name === 'AbortError') return
    throw error
  }

  for (const slot of toolSlots.values()) {
    if (slot.announced) yield { type: 'tool_progress', toolId: slot.id, chars: slot.args.length }
  }

  const ordered = [...toolSlots.entries()].sort((a, b) => a[0] - b[0]).map(([, slot]) => slot)
  const calls = ordered.map((slot) => ({ modelId: slot.id, name: slot.name, args: safeParse(slot.args) }))
  if (calls.some((call) => !call.modelId || !call.name)) {
    throw new Error('模型返回了不完整的工具调用，请重试或更换模型。')
  }
  const message = {
    role: 'assistant',
    content: text || null,
    ...(calls.length
      ? {
          tool_calls: ordered.map((slot) => ({
            id: slot.id,
            type: 'function',
            function: { name: slot.name, arguments: slot.args }
          }))
        }
      : {})
  }
  yield { type: 'assistant_message', message, toolCalls: calls, reasoned }
  yield { type: 'usage', input: inputTokens, output: outputTokens }
}

async function* streamAnthropicTurn(upstream, signal, controller) {
  const blocks = []
  let inputTokens = 0
  let outputTokens = 0
  try {
    for await (const event of sseEvents(upstream)) {
      if (event?.type === 'error') throw new Error(event.error?.message || '模型接口返回错误。')
      if (event.type === 'message_start') {
        inputTokens = event.message?.usage?.input_tokens ?? 0
      } else if (event.type === 'content_block_start') {
        const block = event.content_block ?? {}
        blocks[event.index] =
          block.type === 'tool_use'
            ? { type: 'tool_use', id: block.id, name: block.name, input: '', lastProgress: 0 }
            : { type: 'text', text: '' }
        if (block.type === 'tool_use') {
          yield { type: 'tool_pending', tool: pendingTool(block.id, block.name) }
        }
      } else if (event.type === 'content_block_delta') {
        const delta = event.delta ?? {}
        const block = blocks[event.index]
        if (!block) continue
        if (delta.type === 'text_delta' && delta.text) {
          block.text += delta.text
          yield { type: 'delta', text: delta.text }
        } else if (delta.type === 'input_json_delta' && delta.partial_json) {
          block.input += delta.partial_json
          const now = Date.now()
          if (now - block.lastProgress >= 120) {
            block.lastProgress = now
            yield { type: 'tool_progress', toolId: block.id, chars: block.input.length }
          }
        }
      } else if (event.type === 'message_delta') {
        if (typeof event.usage?.output_tokens === 'number') outputTokens = event.usage.output_tokens
      }
    }
  } catch (error) {
    if (isAborted(signal, controller) || error?.name === 'AbortError') return
    throw error
  }

  const valid = blocks.filter(Boolean)
  for (const block of valid) {
    if (block.type === 'tool_use') yield { type: 'tool_progress', toolId: block.id, chars: block.input.length }
  }
  const textBlocks = valid.filter((block) => block.type === 'text').map((block) => ({ type: 'text', text: block.text }))
  const toolBlocks = valid.filter((block) => block.type === 'tool_use')
  if (toolBlocks.some((block) => !block.id || !block.name)) {
    throw new Error('模型返回了不完整的工具调用，请重试或更换模型。')
  }
  const toolParts = toolBlocks.map((block) => ({ type: 'tool_use', id: block.id, name: block.name, input: safeParse(block.input) }))
  const calls = toolParts.map((block) => ({ modelId: block.id, name: block.name, args: block.input }))
  const message = { role: 'assistant', content: [...textBlocks, ...toolParts] }
  yield { type: 'assistant_message', message, toolCalls: calls }
  yield { type: 'usage', input: inputTokens, output: outputTokens }
}

async function* streamModelTurn(connection, messages, signal, options = {}) {
  if (!validateConnection(connection)) throw new Error('模型接入参数不完整。')
  const baseUrl = stripSlash(connection.baseUrl) || 'https://api.deepseek.com/v1'
  const headers = { 'content-type': 'application/json' }
  const maxTokens = options.maxTokens ?? 8192
  const withTools = options.tools !== false
  const systemText = options.system ?? SYSTEM_PROMPT
  let url
  let body

  if (connection.provider === 'anthropic') {
    url = anthropicUrl(baseUrl)
    headers['x-api-key'] = connection.apiKey
    headers['anthropic-version'] = '2023-06-01'
    body = {
      model: connection.model,
      max_tokens: maxTokens,
      stream: true,
      system: systemText,
      messages: messages.filter((message) => message.role !== 'system'),
      ...(withTools
        ? { tools: TOOL_DEFS.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })) }
        : {})
    }
  } else {
    url = `${baseUrl}/chat/completions`
    headers.authorization = `Bearer ${connection.apiKey}`
    body = {
      model: connection.model,
      max_tokens: maxTokens,
      stream: true,
      messages: messages.map((message) =>
        message.role === 'system' ? { ...message, content: systemText } : message
      ),
      ...(withTools
        ? { tools: TOOL_DEFS.map((tool) => ({ type: 'function', function: tool })) }
        : {})
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), STEP_TIMEOUT_MS)
  const onAbort = () => controller.abort()
  if (signal?.aborted) controller.abort()
  else signal?.addEventListener('abort', onAbort, { once: true })

  try {
    const upstream = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal })
    if (!upstream.ok || !upstream.body) throw new Error(await upstreamError(upstream))
    if (connection.provider === 'anthropic') yield* streamAnthropicTurn(upstream, signal, controller)
    else yield* streamOpenAiTurn(upstream, signal, controller)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

export async function* runAgentSteps({
  connection,
  turns,
  workspace,
  maxSteps = DEFAULT_MAX_STEPS,
  signal,
  subagent = false,
  revision = null,
  runId = null,
  approvalToken = null
}) {
  if (!workspace || typeof workspace !== 'string' || !workspace.trim()) throw new Error('会话没有关联服务器工作区。')
  const root = resolve(workspace.trim())
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }]
  for (const turn of turns ?? []) {
    if (turn?.content && typeof turn.content === 'string' && turn.content.trim()) {
      messages.push({ role: turn.role === 'assistant' ? 'assistant' : 'user', content: turn.content })
    }
  }
  // 本轮边界号 = 本轮开始前已有的用户消息数（第 0 轮、第 1 轮……），快照按它记录文件版本
  const bound = runId ?? (turns ?? []).filter((turn) => turn?.role === 'user').length - 1
  const toolResultsToMessages =
    connection.provider === 'anthropic'
      ? (results) => [
          {
            role: 'user',
            content: results.map((result) => ({ type: 'tool_result', tool_use_id: result.modelId, content: result.payload }))
          }
        ]
      : (results) => results.map((result) => ({ role: 'tool', tool_call_id: result.modelId, content: result.payload }))

  let totalInput = 0
  let totalOutput = 0
  let failedTools = 0
  let commandRan = false
  let step = 0
  let planItems = null
  let verifiedOnce = false
  let autoFixRemaining = AUTOFIX_LIMIT

  // 推进计划清单状态（未指定 id 时：把第一个 pending 标为 running / 把当前 running 标为 done）
  function* markPlan(status, id) {
    if (!planItems) return
    let item = null
    if (id) {
      item = planItems.find((entry) => entry.id === id)
    } else if (status === 'running') {
      item = planItems.find((entry) => entry.status === 'pending')
    } else if (status === 'done') {
      item = planItems.find((entry) => entry.status === 'running')
    }
    if (item && item.status !== status) {
      item.status = status
      yield { type: 'plan_update', id: item.id, status }
    }
  }

  function* markPlanAllDone() {
    if (!planItems) return
    for (const item of planItems) {
      if (item.status === 'pending' || item.status === 'running') {
        item.status = 'done'
        yield { type: 'plan_update', id: item.id, status: 'done' }
      }
    }
  }

  function* markPlanFailed() {
    if (!planItems) return
    const item = planItems.find((entry) => entry.status === 'running') ?? planItems.find((entry) => entry.status === 'pending')
    if (item) {
      item.status = 'failed'
      yield { type: 'plan_update', id: item.id, status: 'failed' }
    }
  }

  // 一个完整的模型回合：流式转发文本与工具参数，空响应自动重试一次
  async function* runModelTurn() {
    let attempt = 0
    let assistantMessage = null
    let calls = []
    let sawText = false
    let sawReasoning = false
    let turnInput = 0
    let turnOutput = 0
    let modelText = ''
    while (true) {
      if (signal?.aborted) return null
      attempt++
      sawText = false
      sawReasoning = false
      modelText = ''
      assistantMessage = null
      calls = []
      let usage = { input: 0, output: 0 }
      try {
        for await (const event of streamModelTurn(connection, messages, signal)) {
          if (signal?.aborted) return null
          if (event.type === 'delta') {
            sawText = true
            modelText += event.text
            yield { type: 'text', text: event.text }
          } else if (event.type === 'tool_pending') {
            yield { type: 'tool_pending', tool: event.tool }
          } else if (event.type === 'tool_progress') {
            yield { type: 'tool_progress', toolId: event.toolId, chars: event.chars }
          } else if (event.type === 'assistant_message') {
            assistantMessage = event.message
            calls = event.toolCalls
            if (event.reasoned) sawReasoning = true
          } else if (event.type === 'usage') {
            usage = event
          }
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : '模型请求失败。'
        yield { type: 'error', message: detail }
        return null
      }
      turnInput += usage?.input ?? 0
      turnOutput += usage?.output ?? 0

      const empty = calls.length === 0 && !sawText
      if (!empty || attempt >= 2) break
      yield { type: 'warning', message: '模型返回了空响应，正在自动重试…' }
    }
    return { sawText, sawReasoning, assistantMessage, calls, turnInput, turnOutput, modelText }
  }

  // 并行执行一批工具调用并逐个回填结果：单个慢工具不再拖累整批结果显示
  async function* runTools(calls) {
    if (!calls.length) return 0
    let failures = 0
    const queued = calls.map((call, i) => {
      const id = String(call.modelId || `tool-${Date.now()}-${step}-${i}`)
      return {
        call,
        id,
        base: {
          id,
          kind: call.name,
          title: TOOL_LABELS[call.name] ?? call.name,
          command: describeToolCall(call.name, call.args) || undefined,
          state: 'running'
        }
      }
    })
    for (const item of queued) {
      if (signal?.aborted) return failures
      yield { type: 'tool', tool: item.base }
    }

    // 写入前快照：把本轮要写入的目标文件原始内容记入版本（git 式按轮回滚的依据）
    if (revision) {
      const writePaths = []
      for (const item of queued) {
        if (item.call.name !== 'write_file' || typeof item.call.args?.path !== 'string') continue
        try {
          writePaths.push(resolveServerPath(item.call.args.path, root))
        } catch {
          // 忽略非法路径
        }
      }
      if (writePaths.length) await revision.beforeWrites(writePaths)
    }

    const executedById = new Map()
    const compose = (item, executed) => {
      const ok = executed?.ok !== false
      const output = truncateText(executed?.output ?? '')
      return {
        ok,
        output,
        tool: {
          ...item.base,
          state: 'done',
          failed: !ok,
          output,
          path: executed?.path,
          diff: executed?.diff,
          changeKind: executed?.changeKind,
          detail: executed?.detail
        }
      }
    }
    const countFailure = (report) => {
      if (report.ok) return
      failures++
      failedTools++
    }

    // 普通工具并行执行，各自完成后立刻单独下发 tool_result（命令/子任务走下方顺序派发）
    const regular = queued.filter(
      (item) => item.call.name !== 'delegate_task' && item.call.name !== 'execute_command'
    )
    const tasks = regular.map((item) => async () => {
      if (signal?.aborted) return { ok: false, output: '工具执行被中断。' }
      try {
        return await executeTool(item.call.name, item.call.args, root)
      } catch (error) {
        return { ok: false, output: error instanceof Error ? error.message : '工具执行失败。' }
      }
    })
    for await (const { index, value, error } of eachSettled(tasks)) {
      if (signal?.aborted) return failures
      const item = regular[index]
      const executed =
        error === undefined ? value : { ok: false, output: error instanceof Error ? error.message : '工具执行失败。' }
      executedById.set(item.id, executed)
      const report = compose(item, executed)
      countFailure(report)
      yield { type: 'tool_result', tool: report.tool }
    }

    // 写入成功后把本轮改动提交为一个版本（git 提交 / 快照记录），供按轮回滚与分支使用
    if (revision) {
      const writes = []
      for (const item of queued) {
        if (item.call.name !== 'write_file') continue
        const executed = executedById.get(item.id)
        if (!executed || executed.ok === false) continue
        try {
          writes.push({ path: resolveServerPath(item.call.args.path, root), ok: true })
        } catch {
          // 忽略非法路径
        }
      }
      if (writes.length) await revision.afterWrites(bound, '', writes)
    }

    // 子任务顺序派发：需要实时转发子代理的流式事件，必须 yield*
    for (const item of queued) {
      if (item.call.name !== 'delegate_task') continue
      if (signal?.aborted) return failures
      if (subagent) {
        executedById.set(item.id, { ok: false, output: '子代理内部不允许再派生子任务，请直接在当前子任务中完成。' })
      } else {
        const report = yield* runSubagent(item.call, item.id)
        executedById.set(item.id, report)
      }
      const composed = compose(item, executedById.get(item.id))
      countFailure(composed)
      yield { type: 'tool_result', tool: composed.tool }
    }

    // 需要人工批准的命令顺序执行：先发审批事件等用户决议，批准后再运行
    for (const item of queued) {
      if (item.call.name !== 'execute_command') continue
      if (signal?.aborted) return failures
      const executed = yield* runCommandApproved(item.call, item.id)
      if (executed?.ok === true) commandRan = true
      executedById.set(item.id, executed)
      const composed = compose(item, executedById.get(item.id))
      countFailure(composed)
      yield { type: 'tool_result', tool: composed.tool }
    }

    const results = []
    for (const item of queued) {
      const executed = executedById.get(item.id) ?? { ok: false, output: '工具执行被中断。' }
      results.push({
        modelId: item.call.modelId,
        payload: JSON.stringify({ ok: executed.ok !== false, output: truncateText(executed.output ?? '') })
      })
    }
    if (results.length) messages.push(...toolResultsToMessages(results))
    return failures
  }

  // 命令审批与执行：发 approval 事件 → 等用户决议 → 批准后 runCommand；拒绝/超时/中断返回失败
  async function* runCommandApproved(call, id) {
    const command = typeof call.args?.command === 'string' ? call.args.command.trim() : ''
    if (!command) return { ok: false, output: '命令为空，未执行。' }
    let cwd = root
    if (typeof call.args?.cwd === 'string' && call.args.cwd.trim()) {
      try {
        cwd = workspacePath(root, call.args.cwd)
      } catch (error) {
        return { ok: false, output: error instanceof Error ? error.message : '命令目录无效。' }
      }
    }
    const { id: approvalId, promise } = createApproval({ command, cwd, token: approvalToken, signal })
    yield {
      type: 'approval',
      approvalId,
      toolId: id,
      command,
      cwd,
      detail: typeof call.args?.detail === 'string' ? call.args.detail : '',
      time: Date.now(),
      timeoutMs: APPROVAL_TIMEOUT_MS
    }
    yield { type: 'tool', tool: { id, kind: 'execute_command', title: '执行命令', command, state: 'waiting' } }
    let approved = false
    try {
      await promise
      approved = true
    } catch (error) {
      return { ok: false, output: error instanceof Error ? error.message : '命令未执行。' }
    }
    if (!approved || signal?.aborted) return { ok: false, output: '命令执行被中断。' }
    const background = call.args?.background === true
    yield {
      type: 'tool',
      tool: { id, kind: 'execute_command', title: background ? '后台执行命令' : '执行命令', command, state: 'running' }
    }
    return await runCommand(command, { cwd, signal, background })
  }

  // 把独立子任务派发给子代理执行（子代理有自己独立的执行循环，工具事件会实时转发）
  async function* runSubagent(call, id) {
    let report = ''
    let subInput = 0
    let subOutput = 0
    try {
      for await (const event of runAgentSteps({
        connection,
        turns: [{ role: 'user', content: String(call.args?.task ?? '') }],
        workspace: root,
        maxSteps: DELEGATE_MAX_STEPS,
        signal,
        subagent: true,
        revision,
        runId: bound,
        approvalToken
      })) {
        if (signal?.aborted) return { ok: false, output: '子任务被中断。' }
        if (event.type === 'usage') {
          subInput += event.input ?? 0
          subOutput += event.output ?? 0
          totalInput += event.input ?? 0
          totalOutput += event.output ?? 0
        } else if (event.type === 'text') {
          report += event.text
        } else if (
          event.type === 'tool' ||
          event.type === 'tool_pending' ||
          event.type === 'tool_progress' ||
          event.type === 'tool_result' ||
          event.type === 'approval' ||
          event.type === 'warning' ||
          event.type === 'error'
        ) {
          if (event.type === 'tool' || event.type === 'tool_result') {
            yield { ...event, tool: { ...event.tool, title: `子任务｜${event.tool.title}` } }
          } else {
            yield event
          }
        }
      }
    } catch (error) {
      totalInput += subInput
      totalOutput += subOutput
      return { ok: false, output: error instanceof Error ? error.message : '子任务执行失败。' }
    }
    totalInput += subInput
    totalOutput += subOutput
    const trimmed = report.trim()
    return { ok: true, output: trimmed ? trimmed : '子任务已完成（未产生文字总结）。' }
  }

  function* finishDone() {
    if (failedTools > 0) {
      yield { type: 'warning', message: `${failedTools} 个工具执行失败，部分操作可能没有完成，请查看上方工具输出。` }
    }
    if (commandRan && !subagent) {
      yield {
        type: 'warning',
        message: '本轮执行过命令，命令对文件的改动不纳入按轮回滚；如需还原请手动处理。'
      }
    }
    yield* markPlanAllDone()
    if (!subagent) {
      yield { type: 'phase', phase: 'done', label: failedTools > 0 ? '任务完成（部分工具失败）' : '任务完成' }
    }
    yield { type: 'usage', input: totalInput, output: totalOutput }
  }

  function* finishAborted(label, errorText) {
    if (errorText) yield { type: 'error', message: errorText }
    yield* markPlanFailed()
    if (!subagent) yield { type: 'phase', phase: 'done', label }
    yield { type: 'usage', input: totalInput, output: totalOutput }
  }

  // 对话历史过长时，把早期内容压缩成摘要以控制上下文占用
  async function* maybeCompact() {
    if (estimateTokens(messages) < COMPACT_THRESHOLD) return
    const keep = 6
    const middle = messages.slice(1, Math.max(1, messages.length - keep))
    if (middle.length < 4) return
    if (!subagent) {
      yield { type: 'phase', phase: 'compacting', label: '对话较长，正在压缩历史上下文…' }
    }
    let summaryText = ''
    let cInput = 0
    let cOutput = 0
    try {
      for await (const event of streamModelTurn(
        connection,
        [{ role: 'system', content: SYSTEM_PROMPT }, ...middle],
        signal,
        {
          tools: false,
          maxTokens: 1024,
          system: SYSTEM_PROMPT + COMPACT_SYSTEM_HINT
        }
      )) {
        if (signal?.aborted) return
        if (event.type === 'delta') summaryText += event.text
        else if (event.type === 'usage') {
          cInput += event.input ?? 0
          cOutput += event.output ?? 0
        }
      }
    } catch {
      return
    }
    totalInput += cInput
    totalOutput += cOutput
    const summary = summaryText.trim()
    if (!summary) return
    messages.splice(1, middle.length, { role: 'user', content: `【历史对话摘要（已压缩，取代此前早期对话）】\n${summary}` })
    if (!subagent) {
      yield { type: 'warning', message: '早期对话已压缩为摘要，上下文占用已降低。' }
    }
  }

  // ——— 计划回合：先产出结构化执行计划，让前端渲染清单 ———
  if (!subagent) {
    if (signal?.aborted) return
    yield { type: 'phase', phase: 'planning', label: '正在分析任务并制定执行计划…' }
    try {
      let planText = ''
      for await (const event of streamModelTurn(connection, messages, signal, {
        tools: false,
        maxTokens: 2048,
        system: SYSTEM_PROMPT + PLAN_SYSTEM_HINT
      })) {
        if (signal?.aborted) return
        if (event.type === 'delta') planText += event.text
        else if (event.type === 'usage') {
          totalInput += event.input ?? 0
          totalOutput += event.output ?? 0
        }
      }
      const parsed = parsePlan(planText)
      if (parsed) {
        planItems = parsed.map((item) => ({ id: item.id, title: item.title, status: 'pending' }))
        yield { type: 'plan', plan: planItems }
        messages.push({
          role: 'user',
          content:
            '执行计划如下，请优先按计划顺序逐项完成，全部完成后给出简短总结：\n' +
            parsed.map((item, index) => `${index + 1}. ${item.title}`).join('\n')
        })
      }
    } catch {
      // 计划生成失败或计划为空时静默直接推进，不打扰用户
    }
  }

  while (step < maxSteps) {
    if (signal?.aborted) return
    step++
    if (!subagent) {
      yield { type: 'step', index: step, total: maxSteps }
      yield { type: 'phase', phase: 'executing', label: `正在执行第 ${step} 个回合…` }
    }
    yield* markPlan('running')
    yield* maybeCompact()

    const turn = yield* runModelTurn()
    if (signal?.aborted) return
    totalInput += turn?.turnInput ?? 0
    totalOutput += turn?.turnOutput ?? 0
    if (!turn) {
      yield* finishAborted('任务中止')
      return
    }
    const { sawText, sawReasoning, assistantMessage, calls } = turn

    if (!calls.length) {
      if (!sawText) {
        if (sawReasoning) {
          yield* finishAborted(
            '任务中止',
            '模型一直在推理但没有产出回复：很可能是推理过程占满了单次输出上限（当前最多 8192 tokens），或模型处理超长工具结果时被截断。建议拆分任务、避免一次读取过大的文件，或更换非推理型模型后重试。'
          )
        } else {
          yield* finishAborted('任务中止', '模型连续返回空响应（没有内容也没有工具调用），请检查模型接入后重试。')
        }
        return
      }

      // 模型本轮没有调用工具（可能认为已完成）→ 先做一次验证回合，防止“假装完成”
      if (!verifiedOnce && !subagent) {
        verifiedOnce = true
        yield { type: 'phase', phase: 'verifying', label: '模型表示已完成，正在验证结果…' }
        let vAssistant = null
        let vCalls = []
        let vUsage = { input: 0, output: 0 }
        let verifierFailed = false
        try {
          for await (const event of streamModelTurn(connection, messages, signal, {
            system: SYSTEM_PROMPT + VERIFY_SYSTEM_HINT
          })) {
            if (signal?.aborted) return
            if (event.type === 'delta') {
              yield { type: 'text', text: event.text }
            } else if (event.type === 'assistant_message') {
              vAssistant = event.message
              vCalls = event.toolCalls
            } else if (event.type === 'usage') {
              vUsage = event
            }
          }
        } catch (error) {
          verifierFailed = true
        }
        totalInput += vUsage?.input ?? 0
        totalOutput += vUsage?.output ?? 0

        if (!verifierFailed && vCalls.length && vAssistant) {
          // 验证发现遗漏：执行这些工具后回到主循环继续
          messages.push(vAssistant)
          yield* runTools(vCalls)
          continue
        }
      }
      yield* finishDone()
      return
    }

    if (!assistantMessage) {
      yield* finishAborted('任务中止', '模型没有返回有效内容。')
      return
    }
    messages.push(assistantMessage)
    const failedInTurn = yield* runTools(calls)
    if (failedInTurn > 0 && autoFixRemaining > 0) {
      autoFixRemaining--
      if (!subagent) {
        yield { type: 'phase', phase: 'fixing', label: `正在自动修复失败的 ${failedInTurn} 个工具…` }
      }
      yield { type: 'warning', message: `${failedInTurn} 个工具执行失败，正在自动尝试修复（剩余 ${autoFixRemaining} 次自动修复机会）…` }
      messages.push({
        role: 'user',
        content: `上面有 ${failedInTurn} 个工具调用失败。请先分析失败原因，再调用工具修复；修复完成后再继续推进任务，不要跳过失败项直接总结。`
      })
      continue
    }
    if (failedInTurn > 0) yield* markPlanFailed()
    yield* markPlan('done')
  }

  // 达到回合上限
  if (failedTools > 0) {
    yield { type: 'warning', message: `${failedTools} 个工具执行失败，部分操作可能没有完成，请查看上方工具输出。` }
  }
  if (commandRan && !subagent) {
    yield {
      type: 'warning',
      message: '本轮执行过命令，命令对文件的改动不纳入按轮回滚；如需还原请手动处理。'
    }
  }
  yield { type: 'warning', message: `已达到最大回合数（${maxSteps}），任务可能尚未完全结束，建议缩小范围或分步执行。` }
  yield* markPlanAllDone()
  if (!subagent) yield { type: 'phase', phase: 'done', label: '已到回合上限' }
  yield { type: 'usage', input: totalInput, output: totalOutput }
}
