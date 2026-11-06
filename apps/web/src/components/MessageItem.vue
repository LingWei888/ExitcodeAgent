<script setup lang="ts">
import { computed, ref } from 'vue'
import { Bot, Check, ChevronDown, Copy, GitBranch, Undo2, User } from 'lucide-vue-next'
import type { Message, ToolCall } from '../types'
import ToolCallItem from './ToolCallItem.vue'
import ToolCallGroup from './ToolCallGroup.vue'
import MarkdownRenderer from './MarkdownRenderer.vue'

const emit = defineEmits<{ undo: []; branch: [] }>()
const props = defineProps<{
  message: Message
  phase?: string
  step?: { index: number; total?: number } | null
  undoDisabled?: boolean
}>()
const thinkingOpen = ref(false)
const copied = ref(false)

const statusLabel = computed(() => {
  if (props.message.status === 'streaming') return '运行中'
  if (props.message.status === 'pending') return '思考中'
  if (props.message.status === 'error') return '失败'
  return '已完成'
})

const liveStatus = computed(() => {
  if (props.message.status !== 'streaming') return ''
  switch (props.phase) {
    case 'planning':
      return '正在规划执行计划…'
    case 'executing':
      return props.step
        ? `正在执行 · 第 ${props.step.index}${props.step.total ? `/${props.step.total}` : ''} 回合…`
        : '正在执行…'
    case 'verifying':
      return '正在验证结果…'
    case 'compacting':
      return '正在压缩历史上下文…'
    case 'fixing':
      return '正在自动修复失败的步骤…'
    case 'done':
      return ''
    default:
      return '正在思考…'
  }
})

const hasBlocks = computed(() => (props.message.blocks?.length ?? 0) > 0)
const planStatusText: Record<string, string> = {
  pending: '待办',
  running: '进行中',
  done: '已完成',
  failed: '失败'
}
const timelineBlocks = computed(() =>
  (props.message.blocks ?? []).map((block) =>
    block.type === 'text'
      ? { type: 'text' as const, text: block.text }
      : { type: 'tool' as const, tool: props.message.tools.find((tool) => tool.id === block.id) }
  )
)

// 把消息内连续、已成功完成的工具节点折叠为一条可展开汇总
const foldedBlocks = computed(() => {
  const out: Array<
    | { type: 'text'; text: string }
    | { type: 'tool'; tool: ToolCall }
    | { type: 'group'; tools: ToolCall[] }
  > = []
  let group: ToolCall[] = []
  const flush = () => {
    if (group.length >= 2) out.push({ type: 'group', tools: group })
    else if (group.length === 1) out.push({ type: 'tool', tool: group[0] })
    group = []
  }
  for (const block of timelineBlocks.value) {
    if (block.type === 'tool') {
      if (block.tool && block.tool.state === 'done' && !block.tool.failed) {
        group.push(block.tool)
      } else {
        flush()
        if (block.tool) out.push({ type: 'tool', tool: block.tool })
      }
    } else {
      flush()
      out.push(block)
    }
  }
  flush()
  return out
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
        <button
          class="undo-round"
          type="button"
          title="回到这一轮之前（丢弃之后的消息，文件改动会自动回滚，可一键还原）"
          :disabled="undoDisabled"
          @click="emit('undo')"
        >
          <Undo2 :size="12" />
          撤销这一轮
        </button>
        <button
          class="undo-round"
          type="button"
          title="先把当前分支合并进主分支，再从主分支新建一个全新空会话"
          :disabled="undoDisabled"
          @click="emit('branch')"
        >
          <GitBranch :size="12" />
          由此新建分支
        </button>
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
        <span v-if="message.status === 'streaming' && message.step" class="step-chip">
          <span class="mini-dot pulse"></span>
          第 {{ message.step.index }}{{ message.step.total ? `/${message.step.total}` : '' }} 回合
        </span>
        <span v-else-if="message.stepsUsed" class="step-chip">共 {{ message.stepsUsed }} 回合</span>
        <time>{{ message.time }}</time>
        <button v-if="message.content" class="copy-link" type="button" :aria-label="copied ? '已复制' : '复制回复'" @click="copyContent">
          <Check v-if="copied" :size="12" />
          <Copy v-else :size="12" />
        </button>
      </div>

      <div v-if="liveStatus" class="live-status">
        <span class="bounce-dots"><i></i><i></i><i></i></span>
        <span class="live-status-text">{{ liveStatus }}</span>
      </div>

      <div v-if="message.plan?.length" class="plan-block">
        <div class="plan-head">
          <span class="plan-dot-head" :class="{ pulse: message.status !== 'done' }"></span>
          执行计划
        </div>
        <ol class="plan-list">
          <li
            v-for="(item, index) in message.plan"
            :key="item.id"
            class="plan-item"
            :class="item.status"
          >
            <span class="plan-idx">{{ index + 1 }}</span>
            <span class="plan-title">{{ item.title }}</span>
            <span class="plan-status" :class="item.status">{{ planStatusText[item.status] }}</span>
          </li>
        </ol>
      </div>

      <button v-if="message.thinking" class="thinking-toggle" type="button" @click="thinkingOpen = !thinkingOpen">
        <ChevronDown :size="14" :class="{ open: thinkingOpen }" />
        思考过程
      </button>
      <div v-if="thinkingOpen && message.thinking" class="thinking-block">{{ message.thinking }}</div>

      <div v-if="hasBlocks" class="timeline-blocks">
        <template v-for="(block, index) in foldedBlocks" :key="`${block.type}-${index}`">
          <MarkdownRenderer
            v-if="block.type === 'text'"
            class="content-block"
            :class="{ 'content-empty': !block.text }"
            :text="block.text"
            :streaming="message.status === 'streaming'"
          />
          <ToolCallItem v-else-if="block.type === 'tool'" class="content-tool" :tool="block.tool" />
          <ToolCallGroup v-else-if="block.type === 'group'" :tools="block.tools" />
        </template>
        <span v-if="message.status === 'streaming'" class="stream-caret"></span>
      </div>

      <template v-else>
        <div v-if="message.tools.length" class="tools-list">
          <ToolCallItem v-for="tool in message.tools" :key="tool.id" :tool="tool" />
        </div>
        <MarkdownRenderer
          v-if="message.content || message.status !== 'done'"
          class="content-block"
          :text="message.content"
          :streaming="message.status === 'streaming'"
        />
      </template>

      <div v-if="message.warnings?.length" class="warnings-block">
        <div v-for="warning in message.warnings" :key="warning" class="warning-line">{{ warning }}</div>
      </div>
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
  background: rgba(28, 37, 34, 0.08);
  color: var(--text-secondary);
}

.avatar.agent {
  background: var(--accent);
  color: #ffffff;
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

.undo-round {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  color: var(--text-muted);
  font-size: 11px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease, color 0.15s ease, background-color 0.15s ease;
}

.msg-row.user:hover .undo-round {
  opacity: 1;
  pointer-events: auto;
}

.undo-round:hover {
  background: rgba(28, 37, 34, 0.08);
  color: var(--text-secondary);
}

.undo-round:disabled {
  opacity: 0.35;
  pointer-events: none;
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

.step-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 1px 7px;
  border: 1px solid rgba(15, 133, 118, 0.35);
  border-radius: 999px;
  background: var(--teal-soft);
  color: var(--teal);
  font-family: var(--font-mono);
  font-size: 10px;
}

.mini-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

.mini-dot.pulse {
  animation: dot-pulse 1s ease-in-out infinite;
}

.warnings-block {
  margin-top: 10px;
  padding: 8px 12px;
  border-left: 2px solid var(--warning);
  background: rgba(169, 116, 16, 0.08);
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.6;
}

.warning-line + .warning-line {
  margin-top: 4px;
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
  background: rgba(28, 37, 34, 0.07);
  color: var(--text);
}

.user-bubble {
  display: inline-block;
  max-width: 640px;
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--text);
  color: var(--bg);
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
  background: rgba(169, 116, 16, 0.08);
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.65;
}

.plan-block {
  margin-bottom: 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-m);
  background: var(--bg-soft);
  overflow: hidden;
}

.plan-head {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 12px;
  border-bottom: 1px solid var(--border);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 700;
}

.plan-dot-head {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
}

.plan-dot-head.pulse {
  animation: dot-pulse 1s ease-in-out infinite;
}

.plan-list {
  margin: 0;
  padding: 4px 0;
  list-style: none;
}

.plan-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px;
  font-size: 12px;
  line-height: 1.5;
}

.plan-item + .plan-item {
  border-top: 1px dashed var(--border);
}

.plan-idx {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 17px;
  height: 17px;
  flex: none;
  border-radius: 50%;
  background: var(--bg-raised);
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
}

.plan-title {
  min-width: 0;
  flex: 1;
  color: var(--text-secondary);
}

.plan-status {
  flex: none;
  color: var(--text-muted);
  font-size: 10px;
}

.plan-item.running .plan-idx {
  background: var(--accent);
  color: #ffffff;
}

.plan-item.running .plan-status {
  color: var(--accent);
  font-weight: 700;
}

.plan-item.running .plan-status::before {
  content: '◌ ';
  animation: dot-pulse 1s ease-in-out infinite;
}

.plan-item.done .plan-status {
  color: var(--teal);
}

.plan-item.done .plan-status::before {
  content: '✓ ';
}

.plan-item.failed .plan-title,
.plan-item.failed .plan-status {
  color: var(--danger);
}

.plan-item.failed .plan-status::before {
  content: '✕ ';
}

.timeline-blocks + .warnings-block {
  margin-top: 12px;
}

.tools-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.timeline-blocks {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.content-block {
  margin: 0;
}

.content-tool {
  margin: 4px 0;
}

.stream-caret::after {
  content: '▍';
  color: var(--accent);
  animation: caret-blink 0.9s steps(1) infinite;
}

.live-status {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 2px 0 10px;
  color: var(--text-secondary);
  font-size: 12px;
}

.live-status-text {
  color: var(--text-muted);
}

.bounce-dots {
  display: inline-flex;
  gap: 3px;
  padding: 5px 8px;
  border-radius: 999px;
  background: var(--bg-soft);
  border: 1px solid var(--border);
}

.bounce-dots i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent);
  animation: bounce-dot 1.2s ease-in-out infinite;
}

.bounce-dots i:nth-child(2) {
  animation-delay: 0.18s;
}

.bounce-dots i:nth-child(3) {
  animation-delay: 0.36s;
}

@keyframes bounce-dot {
  0%, 100% {
    transform: translateY(0);
    opacity: 0.35;
  }
  30% {
    transform: translateY(-3px);
    opacity: 1;
  }
}

@keyframes dot-pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.25;
  }
}
</style>
