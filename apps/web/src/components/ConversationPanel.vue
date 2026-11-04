<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ArrowUp, GitBranch, Settings2, Square, Terminal } from 'lucide-vue-next'
import { appendUserMessage, createAssistantMessage, currentConnection, currentSession, store } from '../store'
import type { Session } from '../types'
import { sessionToTurns, streamModel, toFriendlyError } from '../services/model'
import MessageItem from './MessageItem.vue'

const draft = ref('')
const listEl = ref<HTMLElement | null>(null)
const textareaEl = ref<HTMLTextAreaElement | null>(null)
const runState = ref<'idle' | 'running'>('idle')
const inputError = ref('')
const controller = ref<AbortController | null>(null)
const activeMessageId = ref('')

const session = computed<Session>(() => currentSession() as Session)
const messages = computed(() => session.value.messages)
const connection = computed(() => currentConnection())
const isRunning = computed(() => runState.value === 'running')
const activeMessage = computed(() => messages.value.find((m) => m.id === activeMessageId.value))

async function scrollToBottom(): Promise<void> {
  await nextTick()
  const el = listEl.value
  if (el) el.scrollTop = el.scrollHeight
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
  appendUserMessage(text)
  const message = createAssistantMessage()
  activeMessageId.value = message.id
  const turns = sessionToTurns(session.value.messages)

  const aborter = new AbortController()
  controller.value = aborter
  runState.value = 'running'

  let inputTokens = 0
  let outputTokens = 0
  try {
    for await (const event of streamModel(connection.value, turns, aborter.signal)) {
      if (event.text) message.content += event.text
      if (event.usage) {
        inputTokens = event.usage.input
        outputTokens = event.usage.output
      }
    }
    if (inputTokens || outputTokens) {
      session.value.runTokens.input += inputTokens
      session.value.runTokens.output += outputTokens
    }
    message.status = 'done'
  } catch (error) {
    if (aborter.signal.aborted) {
      if (!message.content) message.content = '已停止。'
      message.status = 'done'
    } else {
      message.status = 'error'
      const detail = toFriendlyError(error)
      message.content = message.content ? `${message.content}\n\n${detail}` : detail
    }
  } finally {
    runState.value = 'idle'
    controller.value = null
    activeMessageId.value = ''
  }
}

function stop(): void {
  controller.value?.abort()
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
          <span class="chip"><GitBranch :size="12" /> {{ session.branch }}</span>
          <span class="chip">{{ connection?.label ?? '未配置模型' }}</span>
          <span class="msg-count">{{ messages.length }} 条消息</span>
        </div>
      </div>
    </header>

    <div ref="listEl" class="messages-scroll">
      <div class="messages-inner">
        <MessageItem v-for="message in messages" :key="message.id" :message="message" />

        <div v-if="!messages.length" class="empty-state">
          <div class="empty-icon"><Terminal :size="22" /></div>
          <h2>{{ session.title }}</h2>
          <p>描述你想让模型完成的任务，它会直接在当前会话里给出答案。</p>
          <div class="suggestions">
            <button type="button" @click="suggest('梳理一下这个项目接下来该做什么')">梳理一下这个项目接下来该做什么</button>
            <button type="button" @click="suggest('把当前会话的要点总结给我')">把当前会话的要点总结给我</button>
            <button type="button" @click="suggest('给这个平台想几个演示入口')">给这个平台想几个演示入口</button>
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
          <span>{{ isRunning ? '生成中' : connection?.label ?? '未配置模型' }}</span>
          <span class="divider"></span>
          <span class="save-note">数据加密保存在服务器</span>
        </div>
      </div>
    </footer>
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
