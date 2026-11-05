<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ArrowUp, Eraser, FolderOpen, GitBranch, GitMerge, Settings2, Square, Terminal, X } from 'lucide-vue-next'
import {
  appendUserMessage,
  clearChat,
  createAssistantMessage,
  createSession,
  currentConnection,
  currentProject,
  currentSession,
  dismissSessionUndo,
  restoreSessionUndo,
  store,
  undoSessionAt
} from '../store'
import type { Message, PlanItemStatus, Session, ToolCall } from '../types'
import { runAgent } from '../services/agent'
import { forkSessionFromMain, mergeSessionToMain, restoreSessionFiles } from '../services/api'
import { sessionToTurns, streamModel, toFriendlyError } from '../services/model'
import MessageItem from './MessageItem.vue'
import BranchGraph from './BranchGraph.vue'

const draft = ref('')
const listEl = ref<HTMLElement | null>(null)
const textareaEl = ref<HTMLTextAreaElement | null>(null)
const runState = ref<'idle' | 'running'>('idle')
const inputError = ref('')
const controller = ref<AbortController | null>(null)
const activeMessageId = ref('')
const stepState = ref<{ index: number } | null>(null)
const runPhase = ref<'planning' | 'executing' | 'verifying' | 'compacting' | 'done' | ''>('')
const graphOpen = ref(false)
const merging = ref(false)
const confirmClear = ref(false)
const notice = ref('')
let noticeTimer: number | undefined
let clearTimer: number | undefined
let autoScroll = true
let scrollRaf = 0

function flashNotice(message: string): void {
  notice.value = message
  if (noticeTimer) window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => {
    notice.value = ''
  }, 5000)
}

const session = computed<Session>(() => currentSession() as Session)
const messages = computed(() => session.value.messages)
const connection = computed(() => currentConnection())
const workspace = computed(() => currentProject()?.directoryName ?? '')
const isRunning = computed(() => runState.value === 'running')
const activeMessage = computed(() => messages.value.find((m) => m.id === activeMessageId.value))
const phaseText = computed(() => {
  switch (runPhase.value) {
    case 'planning':
      return '正在规划任务'
    case 'verifying':
      return '正在验证结果'
    case 'compacting':
      return '正在压缩历史上下文'
    case 'done':
      return '已完成'
    default:
      return '正在执行'
  }
})
const runLabel = computed(() => {
  if (!isRunning.value) return ''
  const round = stepState.value ? `回合 ${stepState.value.index} · ` : ''
  return `${round}${phaseText.value}`
})
const tokenLabel = computed(() => {
  const input = session.value.runTokens.input
  const output = session.value.runTokens.output
  if (!input && !output) return ''
  return `已用 ${((input + output) / 1000).toFixed(1)}K tokens`
})

function upsertTool(message: Message, tool: ToolCall): void {
  const index = message.tools.findIndex((item) => item.id === tool.id)
  if (index >= 0) message.tools[index] = { ...message.tools[index], ...tool }
  else message.tools.push(tool)
}

function recordFileChange(tool: ToolCall): void {
  if (tool.kind !== 'write_file' || !tool.path) return
  const kind = tool.changeKind === 'created' ? 'created' : 'modified'
  const summary = tool.detail || tool.output?.split('\n')[0] || '已更新'
  session.value.filesChanged = session.value.filesChanged.filter((item) => item.path !== tool.path)
  session.value.filesChanged.unshift({ path: tool.path, kind, summary })
}

function appendAssistantText(message: Message, chunk: string): void {
  message.content += chunk
  const blocks = message.blocks ?? (message.blocks = [])
  const last = blocks[blocks.length - 1]
  if (last?.type === 'text') last.text += chunk
  else blocks.push({ type: 'text', text: chunk })
}

function ensureToolBlock(message: Message, toolId: string): void {
  const blocks = message.blocks ?? (message.blocks = [])
  if (!blocks.some((block) => block.type === 'tool' && block.id === toolId)) {
    blocks.push({ type: 'tool', id: toolId })
  }
}

function onMessagesScroll(): void {
  const el = listEl.value
  if (!el) return
  autoScroll = el.scrollTop + el.clientHeight >= el.scrollHeight - 90
}

async function scrollToBottom(): Promise<void> {
  await nextTick()
  if (scrollRaf) return
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0
    if (!autoScroll) return
    const el = listEl.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

watch(messages, () => scrollToBottom(), { deep: true })
watch(
  () => activeMessage.value?.content,
  () => scrollToBottom()
)
watch(
  () => session.value.id,
  () => {
    draft.value = ''
    inputError.value = ''
    scrollToBottom()
  }
)

function autosize(): void {
  const el = textareaEl.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 180)}px`
}

async function send(): Promise<void> {
  const text = draft.value.trim()
  if (!text || isRunning.value) return
  if (!connection.value) {
    inputError.value = '还没有模型接入，先到右上角设置添加 API Key。'
    store.showSettings = true
    return
  }

  inputError.value = ''
  draft.value = ''
  autosize()
  session.value.truncatedTail = undefined
  appendUserMessage(text)
  const message = createAssistantMessage()
  activeMessageId.value = message.id
  const turns = sessionToTurns(session.value.messages)

  const aborter = new AbortController()
  controller.value = aborter
  runState.value = 'running'
  store.streaming = true
  stepState.value = null
  runPhase.value = ''

  let inputTokens = 0
  let outputTokens = 0
  const warnings: string[] = []
  let runError = ''
  try {
    if (workspace.value) {
      for await (const event of runAgent(connection.value, turns, workspace.value, session.value.id, aborter.signal)) {
        if (event.type === 'step') {
          const step = { index: event.index ?? 1 }
          stepState.value = step
          message.step = step
        } else if (event.type === 'phase') {
          runPhase.value = event.phase ?? ''
        } else if (event.type === 'plan' && Array.isArray(event.plan)) {
          message.plan = event.plan
        } else if (event.type === 'plan_update' && event.planId && message.plan) {
          const item = message.plan.find((entry) => entry.id === event.planId)
          if (item && event.planStatus) item.status = event.planStatus as PlanItemStatus
        } else if (event.type === 'text' && event.text) {
          appendAssistantText(message, event.text)
        } else if (event.type === 'tool_pending' && event.tool) {
          upsertTool(message, event.tool)
          ensureToolBlock(message, event.tool.id)
        } else if (event.type === 'tool_progress' && event.toolId) {
          const target = message.tools.find((item) => item.id === event.toolId)
          if (target && target.state === 'pending') {
            target.progressChars = event.chars ?? 0
          }
        } else if (event.tool) {
          upsertTool(message, event.tool)
          if (event.type === 'tool') ensureToolBlock(message, event.tool.id)
          if (event.type === 'tool_result') {
            recordFileChange(event.tool)
            if (event.tool.failed) {
              warnings.push(`工具「${event.tool.title}」执行失败，请查看上方输出。`)
            }
          }
        } else if (event.type === 'warning' && event.message) {
          warnings.push(event.message)
        } else if (event.type === 'usage') {
          inputTokens = event.input ?? 0
          outputTokens = event.output ?? 0
        } else if (event.type === 'error') {
          runError = event.message || 'Agent 执行失败。'
        }
      }
    } else {
      for await (const event of streamModel(connection.value, turns, aborter.signal)) {
        if (event.text) appendAssistantText(message, event.text)
        if (event.usage) {
          inputTokens = event.usage.input
          outputTokens = event.usage.output
        }
      }
    }
    if (warnings.length) message.warnings = warnings
    if (inputTokens || outputTokens) {
      session.value.runTokens.input += inputTokens
      session.value.runTokens.output += outputTokens
    }
    if (stepState.value?.index) message.stepsUsed = stepState.value.index
    if (runError) {
      message.status = 'error'
      appendAssistantText(message, message.content ? `\n\n${runError}` : runError)
    } else {
      message.status = 'done'
    }
  } catch (error) {
    if (aborter.signal.aborted) {
      if (stepState.value?.index) message.stepsUsed = stepState.value.index
      if (!message.content) appendAssistantText(message, '已停止。')
      else appendAssistantText(message, '\n\n（已停止）')
      if (warnings.length) message.warnings = warnings
      message.status = 'done'
    } else {
      if (stepState.value?.index) message.stepsUsed = stepState.value.index
      message.status = 'error'
      const detail = toFriendlyError(error)
      appendAssistantText(message, message.content ? `\n\n${detail}` : detail)
      if (warnings.length) message.warnings = warnings
    }
  } finally {
    runState.value = 'idle'
    controller.value = null
    activeMessageId.value = ''
    stepState.value = null
    runPhase.value = ''
    store.streaming = false
  }
}

function stop(): void {
  controller.value?.abort()
}

async function onUndoRound(messageId: string): Promise<void> {
  const sess = session.value
  if (isRunning.value) return
  const index = sess.messages.findIndex((m) => m.id === messageId)
  if (index < 0) return
  const roundOf = sess.messages.slice(0, index).filter((m) => m.role === 'user').length
  const boundary = roundOf - 1
  let restoredCount = 0
  let restoreFailed = false
  let tipRound = 0
  try {
    const result = await restoreSessionFiles(sess.id, boundary)
    restoredCount = result?.restored?.length ?? 0
    tipRound = result?.tipRound ?? 0
  } catch {
    restoreFailed = true
  }
  undoSessionAt(sess, messageId)
  if (sess.truncatedTail) {
    sess.truncatedTail.filesRestored = restoredCount
    sess.truncatedTail.filesFailed = restoreFailed
    sess.truncatedTail.tipRound = tipRound
  }
}

async function restoreUndo(): Promise<void> {
  const sess = session.value
  if (!sess?.truncatedTail) return
  const { tipRound } = sess.truncatedTail
  restoreSessionUndo(sess)
  // 还原会话消息的同时，把文件恢复到撤销前的最新状态（git 式切换）
  void restoreSessionFiles(sess.id, tipRound ?? null, true).catch(() => {
    // 文件还原失败不阻塞消息还原
  })
}

function dismissUndo(): void {
  dismissSessionUndo(session.value)
}

async function mergeCurrent(): Promise<void> {
  if (isRunning.value || merging.value) return
  merging.value = true
  try {
    const result = await mergeSessionToMain(session.value.id)
    if (result.ok === false || result.conflicts?.length) {
      const conflicts = result.conflicts?.length ? `（冲突文件：${result.conflicts.join('、')}）` : ''
      flashNotice(`${result.error ?? '合并失败'}${conflicts}`)
    } else if (result.merged === 'already') {
      flashNotice('当前分支已包含在主分支中。')
    } else if (result.fastForward) {
      flashNotice('已快进合并到主分支。')
    } else if (result.mergedSha) {
      flashNotice('已合并到主分支。')
    }
  } catch (cause) {
    flashNotice(cause instanceof Error ? cause.message : '合并失败。')
  } finally {
    merging.value = false
  }
}

function requestClearChat(): void {
  const sess = session.value
  if (!sess || isRunning.value) return
  if (confirmClear.value) {
    if (clearTimer) window.clearTimeout(clearTimer)
    confirmClear.value = false
    clearChat(sess)
    flashNotice('聊天记录已清空，文件改动保留。')
    return
  }
  confirmClear.value = true
  clearTimer = window.setTimeout(() => {
    confirmClear.value = false
  }, 3000)
}

async function onBranchRound(messageId: string): Promise<void> {
  const sess = session.value
  if (isRunning.value) return
  const index = sess.messages.findIndex((m) => m.id === messageId)
  const anchor = index >= 0 ? sess.messages[index] : null
  const summary = anchor?.content.trim().slice(0, 16) || sess.title || '对话'
  // 新语义：先把当前分支合并进主分支，再从主分支新建一个全新空会话
  try {
    const result = await mergeSessionToMain(sess.id)
    if (result.ok === false) {
      if (result.code !== 'no-commits') {
        const conflicts = result.conflicts?.length ? `（冲突文件：${result.conflicts.join('、')}）` : ''
        flashNotice(`${result.error ?? '合并失败，未新建分支。'}${conflicts}`)
        return
      }
    } else if (result.conflicts?.length) {
      flashNotice(`合并冲突，未新建分支（冲突文件：${result.conflicts.join('、')}）。`)
      return
    }
    const branch = createSession(`分支 · ${summary}`)
    if (workspace.value) {
      try {
        await forkSessionFromMain(branch.id, workspace.value)
      } catch {
        // 分支元数据写入失败不影响进入空分支
      }
    }
    flashNotice('已把当前分支合并到主分支，并从主分支新建空会话。')
  } catch (cause) {
    flashNotice(cause instanceof Error ? cause.message : '新建分支失败。')
  }
}

function openSettings(): void {
  inputError.value = ''
  store.showSettings = true
}

function suggest(text: string): void {
  draft.value = text
  autosize()
  void send()
}
</script>

<template>
  <main class="conversation">
    <header class="conv-head">
      <div class="conv-title-wrap">
        <h1>{{ session.title }}</h1>
        <div class="conv-meta">
          <span class="chip" title="每个会话是一条从主分支分叉出的分支"><GitBranch :size="12" /> 分支</span>
          <span class="chip">{{ connection?.label ?? '未配置模型' }}</span>
          <span class="chip" :class="{ connected: workspace }">
            <FolderOpen :size="12" />
            {{ workspace ? '服务器工作区' : '未关联工作区' }}
          </span>
          <span class="msg-count">{{ messages.length }} 条消息</span>
          <button
            class="chip"
            type="button"
            :disabled="merging"
            :title="'把当前分支的文件改动合并进主分支'"
            @click="mergeCurrent"
          >
            <GitMerge :size="12" />
            {{ merging ? '合并中…' : '合并到主分支' }}
          </button>
          <button
            class="chip"
            :class="{ confirm: confirmClear }"
            type="button"
            :title="confirmClear ? '再次点击确认清空（文件改动保留）' : '清空聊天记录（只清消息，保留文件改动）'"
            @click="requestClearChat"
          >
            <Eraser :size="12" />
            {{ confirmClear ? '再次点击确认清空' : '清空聊天' }}
          </button>
          <button class="chip graph-chip" type="button" @click="graphOpen = true">
            <GitBranch :size="12" />
            分支图
          </button>
        </div>
      </div>
    </header>

    <div v-if="notice" class="notice-bar">{{ notice }}</div>

    <div v-if="isRunning" class="run-progress"><span class="progress-bar"></span></div>

    <div v-if="session.truncatedTail" class="truncated-bar">
      <span>
        已撤销 {{ session.truncatedTail.removed.length }} 条消息
        <template v-if="session.truncatedTail.filesRestored">，已自动回滚 {{ session.truncatedTail.filesRestored }} 处文件改动</template>
        <template v-else-if="session.truncatedTail.filesFailed">，部分文件未能回滚</template>
      </span>
      <button class="truncated-restore" type="button" @click="restoreUndo">还原（含文件）</button>
      <button class="truncated-close" type="button" aria-label="关闭提示" @click="dismissUndo">
        <X :size="13" />
      </button>
    </div>

    <div ref="listEl" class="messages-scroll" @scroll.passive="onMessagesScroll">
      <div class="messages-inner">
        <MessageItem
          v-for="message in messages"
          :key="message.id"
          :message="message"
          :phase="message.id === activeMessageId ? runPhase : ''"
          :step="message.id === activeMessageId ? stepState : null"
          :undo-disabled="isRunning"
          @undo="onUndoRound(message.id)"
          @branch="onBranchRound(message.id)"
        />

        <div v-if="!messages.length" class="empty-state">
          <div class="empty-icon"><Terminal :size="22" /></div>
          <h2>{{ session.title }}</h2>
          <p>描述你想让模型完成的任务，它会直接在当前会话里给出答案。</p>
          <div class="suggestions">
            <button type="button" @click="suggest('列出当前工作区里的文件结构')">列出当前工作区里的文件结构</button>
            <button type="button" @click="suggest('搜索一下代码里的 TODO')">搜索一下代码里的 TODO</button>
            <button type="button" @click="suggest('修改 README.md，补充快速开始说明')">修改 README.md，补充快速开始说明</button>
          </div>
        </div>
      </div>
    </div>

    <footer class="composer-wrap">
      <p v-if="inputError" class="composer-error">
        {{ inputError }}
        <button type="button" @click="openSettings">去设置</button>
      </p>
      <div class="composer">
        <div class="composer-inner">
          <textarea
            ref="textareaEl"
            v-model="draft"
            class="composer-input"
            rows="1"
            placeholder="描述你想让模型完成的任务…"
            @input="autosize"
            @keydown.enter.prevent="send"
          ></textarea>
          <button
            v-if="isRunning"
            class="send-btn stop"
            type="button"
            aria-label="停止生成"
            title="停止"
            @click="stop"
          >
            <Square :size="16" />
          </button>
          <button
            v-else
            class="send-btn"
            type="button"
            aria-label="发送消息"
            :disabled="!draft.trim()"
            @click="send"
          >
            <ArrowUp :size="18" />
          </button>
        </div>
        <div class="composer-foot">
          <span class="dot" :class="{ pulse: isRunning, warn: !connection }"></span>
          <span>{{ isRunning ? runLabel : connection?.label ?? '未配置模型' }}</span>
          <span class="divider"></span>
          <span v-if="tokenLabel" class="save-note">{{ tokenLabel }}</span>
          <span class="save-note">数据加密保存在服务器</span>
        </div>
      </div>
    </footer>

    <BranchGraph :open="graphOpen" :workspace="workspace" @close="graphOpen = false" />
  </main>
</template>

<style scoped>
.conversation {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
  background: var(--bg);
}

.conv-head {
  flex: none;
  padding: 14px 22px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
}

.conv-title-wrap {
  max-width: 860px;
  margin: 0 auto;
}

.conv-head h1 {
  margin: 0 0 6px;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0;
}

.conv-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.msg-count {
  color: var(--text-muted);
  font-size: 11px;
}

.chip.connected {
  border-color: rgba(15, 133, 118, 0.35);
  color: var(--teal);
  background: var(--teal-soft);
}

.graph-chip {
  cursor: pointer;
  color: var(--text-muted);
  font-family: var(--font-sans);
}

.graph-chip:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
}

.chip:disabled {
  opacity: 0.55;
  cursor: default;
}

.chip.confirm {
  border-color: rgba(217, 67, 67, 0.4);
  color: var(--danger);
  background: rgba(217, 67, 67, 0.1);
}

.notice-bar {
  flex: none;
  max-width: 860px;
  width: 100%;
  margin: 0 auto;
  padding: 8px 22px;
  font-size: 12px;
  color: var(--teal);
  border-bottom: 1px solid var(--border);
  background: var(--teal-soft);
}

.run-progress {
  position: relative;
  flex: none;
  height: 2px;
  overflow: hidden;
  background: var(--bg);
}

.run-progress .progress-bar {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 38%;
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
  animation: progress-slide 1.2s ease-in-out infinite;
}

@keyframes progress-slide {
  0% {
    transform: translateX(-110%);
  }
  100% {
    transform: translateX(370%);
  }
}

.truncated-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
  max-width: 860px;
  width: 100%;
  margin: 0 auto;
  padding: 8px 22px;
  box-sizing: border-box;
  color: var(--text-secondary);
  font-size: 12px;
  background: var(--warning-soft, rgba(169, 116, 16, 0.1));
  border-bottom: 1px solid rgba(169, 116, 16, 0.25);
}

.truncated-bar button {
  font-size: 12px;
  color: var(--accent);
}

.truncated-restore {
  margin-left: auto;
  padding: 3px 10px;
  border: 1px solid rgba(15, 133, 118, 0.35);
  border-radius: 999px;
  background: var(--teal-soft);
  color: var(--teal) !important;
  font-weight: 600;
}

.truncated-restore:hover {
  border-color: var(--teal);
}

.truncated-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-s);
  color: var(--text-muted);
}

.truncated-close:hover {
  background: rgba(28, 37, 34, 0.08);
  color: var(--text);
}

.messages-scroll {
  flex: 1;
  overflow-y: auto;
  scroll-behavior: smooth;
}

.messages-inner {
  max-width: 860px;
  margin: 0 auto;
  padding: 18px 22px 40px;
}

.messages-inner > :not(:last-child) {
  border-bottom: 1px solid var(--border);
}

.empty-state {
  padding: 80px 0;
  text-align: center;
}

.empty-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  margin-bottom: 14px;
  border-radius: var(--radius-m);
  background: var(--accent-soft);
  color: var(--accent);
}

.empty-state h2 {
  margin: 0 0 6px;
  font-size: 18px;
}

.empty-state p {
  max-width: 420px;
  margin: 0 auto 22px;
  color: var(--text-secondary);
  font-size: 13px;
}

.suggestions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}

.suggestions button {
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-soft);
  color: var(--text-secondary);
  font-size: 12px;
}

.suggestions button:hover {
  border-color: var(--accent);
  color: var(--text);
  background: var(--accent-soft);
}

.composer-wrap {
  flex: none;
  padding: 0 22px 18px;
}

.composer-error {
  max-width: 860px;
  margin: 0 auto 8px;
  color: var(--danger);
  font-size: 12px;
}

.composer-error button {
  margin-left: 6px;
  padding: 2px 6px;
  border: 1px solid rgba(217, 67, 67, 0.35);
  border-radius: 3px;
  color: var(--danger);
  font-size: 12px;
}

.composer-error button:hover {
  background: rgba(217, 67, 67, 0.08);
}

.composer {
  max-width: 860px;
  margin: 0 auto;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-m);
  background: var(--bg-soft);
  box-shadow: none;
}

.composer-inner {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 10px 10px 8px;
}

.composer-input {
  min-width: 0;
  flex: 1;
  max-height: 180px;
  padding: 6px 4px;
  resize: none;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--text);
  line-height: 1.55;
}

.composer-input::placeholder {
  color: var(--text-muted);
}

.send-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  flex: none;
  border-radius: var(--radius-s);
  background: var(--accent);
  color: #1b0d04;
  transition: background-color 0.15s ease, opacity 0.15s ease;
}

.send-btn:hover {
  background: var(--accent-hover);
}

.send-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.send-btn.stop {
  background: var(--bg-raised);
  border: 1px solid rgba(217, 67, 67, 0.4);
  color: var(--danger);
}

.composer-foot {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 12px 9px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
}

.composer-foot .divider {
  width: 1px;
  height: 12px;
  background: var(--border);
}

.save-note {
  color: var(--text-muted);
}
</style>
