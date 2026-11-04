import { resolve, sep } from 'node:path'
import { listServerDirectory, readServerFile, searchServerFiles, writeServerFile } from './files.mjs'
import { anthropicUrl, stripSlash, upstreamError, validateConnection } from './model.mjs'

const TOOL_LABELS = {
  list_files: '列出目录',
  read_file: '读取文件',
  write_file: '写入文件',
  grep: '搜索代码'
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
  }
]

const SYSTEM_PROMPT =
  '你是部署在服务器上的编码智能体。你可以列出目录、读取文件、写入文件和搜索代码，工具路径必须基于工作区。' +
  '动手修改前先读取相关文件，保持改动最小，不要破坏无关代码；完成后用中文简要说明你做了什么。'

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

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function splitText(text) {
  const chunks = []
  let rest = text
  while (rest.length > 140) {
    let cut = rest.slice(0, 140).lastIndexOf('\n')
    if (cut < 40) cut = 140
    chunks.push(rest.slice(0, cut + 1))
    rest = rest.slice(cut + 1)
  }
  if (rest) chunks.push(rest)
  return chunks
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
      return { output: lines.join('\n') }
    }
    case 'read_file': {
      const target = workspacePath(workspace, args.path)
      const result = await readServerFile(target, workspace)
      const output = `文件 ${result.path}\n${result.content}${result.truncated ? '\n\n（内容过长，仅显示前 256KB）' : ''}`
      return { output, path: result.path }
    }
    case 'write_file': {
      const target = workspacePath(workspace, args.path)
      const result = await writeServerFile(target, args.content, workspace)
      return {
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
      if (!result.matches.length) return { output: `未找到匹配：${args.pattern}` }
      const lines = result.matches.map((match) => `${match.path}:${match.lineNumber}: ${match.line}`)
      return { output: `匹配 ${result.count} 处\n` + lines.join('\n') }
    }
    default:
      throw new Error(`不支持的工具：${kind}`)
  }
}

async function callModel(connection, messages, signal) {
  if (!validateConnection(connection)) throw new Error('模型接入参数不完整。')
  const baseUrl = stripSlash(connection.baseUrl) || 'https://api.deepseek.com/v1'
  const headers = { 'content-type': 'application/json' }
  let url
  let body

  if (connection.provider === 'anthropic') {
    url = anthropicUrl(baseUrl)
    headers['x-api-key'] = connection.apiKey
    headers['anthropic-version'] = '2023-06-01'
    body = {
      model: connection.model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: messages.filter((message) => message.role !== 'system'),
      tools: TOOL_DEFS.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters }))
    }
  } else {
    url = `${baseUrl}/chat/completions`
    headers.authorization = `Bearer ${connection.apiKey}`
    body = {
      model: connection.model,
      max_tokens: 4096,
      messages,
      tools: TOOL_DEFS.map((tool) => ({ type: 'function', function: tool }))
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 120000)
  const onAbort = () => controller.abort()
  if (signal?.aborted) controller.abort()
  else signal?.addEventListener('abort', onAbort, { once: true })

  let response
  try {
    response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal })
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
  if (!response.ok) throw new Error(await upstreamError(response))

  const data = await response.json()
  const usage = { input: 0, output: 0 }
  if (connection.provider === 'anthropic') {
    const blocks = Array.isArray(data.content) ? data.content : []
    const text = blocks.filter((block) => block.type === 'text').map((block) => block.text).join('')
    const calls = blocks
      .filter((block) => block.type === 'tool_use')
      .map((block) => ({ modelId: block.id, name: block.name, args: safeParse(block.input) }))
    usage.input = data.usage?.input_tokens ?? 0
    usage.output = data.usage?.output_tokens ?? 0
    return {
      text,
      calls,
      assistantMessage: { role: 'assistant', content: blocks },
      toolResultMessages: (results) => [
        { role: 'user', content: results.map((result) => ({ type: 'tool_result', tool_use_id: result.modelId, content: result.payload })) }
      ],
      usage
    }
  }

  const message = data.choices?.[0]?.message ?? {}
  const calls = (message.tool_calls ?? []).map((call) => ({
    modelId: call.id,
    name: call.function?.name,
    args: safeParse(call.function?.arguments)
  }))
  usage.input = data.usage?.prompt_tokens ?? 0
  usage.output = data.usage?.completion_tokens ?? 0
  return {
    text: message.content ?? '',
    calls,
    assistantMessage: { role: 'assistant', content: message.content ?? null, tool_calls: message.tool_calls ?? [] },
    toolResultMessages: (results) => results.map((result) => ({ role: 'tool', tool_call_id: result.modelId, content: result.payload })),
    usage
  }
}

function describeToolCall(kind, args) {
  if (kind === 'grep') return args.pattern ? `grep: ${args.pattern}` : ''
  const path = args.path ?? ''
  return path
}

export async function* runAgentSteps({ connection, turns, workspace, maxSteps = 12, signal }) {
  if (!workspace || typeof workspace !== 'string' || !workspace.trim()) throw new Error('会话没有关联服务器工作区。')
  const root = resolve(workspace.trim())
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }]
  for (const turn of turns ?? []) {
    if (turn?.content && typeof turn.content === 'string') {
      messages.push({ role: turn.role === 'assistant' ? 'assistant' : 'user', content: turn.content })
    }
  }
  let totalInput = 0
  let totalOutput = 0
  let step = 0
  while (step < maxSteps) {
    step++
    yield { type: 'step', index: step }
    const response = await callModel(connection, messages, signal)
    totalInput += response.usage.input
    totalOutput += response.usage.output
    if (!response.calls.length) {
      for (const part of splitText(response.text || '')) yield { type: 'text', text: part }
      yield { type: 'usage', input: totalInput, output: totalOutput }
      return
    }
    messages.push(response.assistantMessage)
    const results = []
    for (const call of response.calls) {
      if (signal?.aborted) return
      const id = `tool-${Date.now()}-${step}-${results.length}`
      const base = {
        id,
        kind: call.name,
        title: TOOL_LABELS[call.name] ?? call.name,
        command: describeToolCall(call.name, call.args) || undefined,
        state: 'running'
      }
      yield { type: 'tool', tool: base }
      let executed
      try {
        executed = await executeTool(call.name, call.args, root)
      } catch (error) {
        executed = { ok: false, output: error instanceof Error ? error.message : '工具执行失败。' }
      }
      const doneTool = {
        ...base,
        state: 'done',
        output: executed.output,
        path: executed.path,
        diff: executed.diff,
        changeKind: executed.changeKind,
        detail: executed.detail
      }
      yield { type: 'tool_result', tool: doneTool }
      results.push({
        modelId: call.modelId,
        payload: JSON.stringify({ ok: executed.ok ?? true, output: executed.output })
      })
    }
    messages.push(...response.toolResultMessages(results))
  }
  yield { type: 'text', text: '\n\n（已达到最大工具调用次数，已停止。请缩小任务范围后重试。）' }
  yield { type: 'usage', input: totalInput, output: totalOutput }
}
