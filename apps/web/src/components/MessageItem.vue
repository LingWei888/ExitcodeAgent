<script setup lang="ts">
import { computed, ref } from 'vue'
import { Bot, Check, ChevronDown, Copy, User } from 'lucide-vue-next'
import type { Message } from '../types'
import ToolCallItem from './ToolCallItem.vue'

const props = defineProps<{ message: Message }>()
const thinkingOpen = ref(false)
const copied = ref(false)

const statusLabel = computed(() => {
  if (props.message.status === 'streaming') return '生成中'
  if (props.message.status === 'pending') return '思考中'
  if (props.message.status === 'error') return '失败'
  return '已完成'
})

async function copyContent(): Promise<void> {
  if (!props.message.content) return
  try {
    await navigator.clipboard.writeText(props.message.content)
    copied.value = true
    setTimeout(() => (copied.value = false), 1400)
  } catch {
    // Ignored: the message remains selectable.
  }
}
</script>

<template>
  <article v-if="message.role === 'user'" class="msg-row user fade-in">
    <span class="avatar user"><User :size="14" /></span>
    <div class="body">
      <div class="meta">
        <span class="who">你</span>
        <time>{{ message.time }}</time>
      </div>
      <div class="user-bubble">{{ message.content }}</div>
    </div>
  </article>

  <article v-else class="msg-row agent fade-in">
    <span class="avatar agent"><Bot :size="15" /></span>
    <div class="body">
      <div class="meta">
        <span class="who">智能体</span>
        <span class="status-chip">
          <span class="dot" :class="{ pulse: message.status !== 'done', warn: message.status === 'error' }"></span>
          {{ statusLabel }}
        </span>
        <time>{{ message.time }}</time>
        <button v-if="message.content" class="copy-link" type="button" :aria-label="copied ? '已复制' : '复制回复'" @click="copyContent">
          <Check v-if="copied" :size="12" />
          <Copy v-else :size="12" />
        </button>
      </div>

      <button v-if="message.thinking" class="thinking-toggle" type="button" @click="thinkingOpen = !thinkingOpen">
        <ChevronDown :size="14" :class="{ open: thinkingOpen }" />
        思考过程
      </button>
      <div v-if="thinkingOpen && message.thinking" class="thinking-block">{{ message.thinking }}</div>

      <div v-if="message.tools.length" class="tools-list">
        <ToolCallItem v-for="tool in message.tools" :key="tool.id" :tool="tool" />
      </div>

      <p v-if="message.content || message.status !== 'done'" class="content" :class="{ typing: message.status === 'streaming' }">
        {{ message.content }}
      </p>
    </div>
  </article>
</template>

<style scoped>
.msg-row {
  display: flex;
  gap: 12px;
  max-width: 860px;
  margin: 0 auto;
  padding: 18px 0;
}

.avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  flex: none;
  border-radius: var(--radius-s);
}

.avatar.user {
  background: rgba(245, 238, 227, 0.08);
  color: var(--text-secondary);
}

.avatar.agent {
  background: var(--accent);
  color: #1b0d04;
}

.body {
  min-width: 0;
  flex: 1;
}

.meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.who {
  font-size: 13px;
  font-weight: 700;
}

.meta time {
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
}

.status-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text-secondary);
  font-size: 11px;
}

.copy-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin-left: auto;
  border-radius: var(--radius-s);
  color: var(--text-muted);
}

.copy-link:hover {
  background: rgba(245, 238, 227, 0.07);
  color: var(--text);
}

.user-bubble {
  display: inline-block;
  max-width: 640px;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-m);
  border-top-left-radius: 2px;
  background: var(--bg-raised);
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
}

.thinking-toggle {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-bottom: 7px;
  color: var(--text-muted);
  font-size: 12px;
}

.thinking-toggle:hover {
  color: var(--text-secondary);
}

.thinking-toggle svg {
  transition: transform 0.16s ease;
}

.thinking-toggle svg.open {
  transform: rotate(180deg);
}

.thinking-block {
  margin-bottom: 10px;
  padding: 10px 12px;
  border-left: 2px solid var(--warning);
  background: rgba(246, 193, 91, 0.06);
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.65;
}

.tools-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.content {
  margin: 0;
  font-size: 14px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}

.content.typing::after {
  content: '▍';
  margin-left: 1px;
  color: var(--accent);
  animation: caret-blink 0.9s steps(1) infinite;
}
</style>
