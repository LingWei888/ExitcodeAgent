<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Copy,
  FilePlus2,
  FileText,
  FolderOpen,
  GitBranch,
  GitCommit,
  Globe,
  PenLine,
  Search,
  TerminalSquare
} from 'lucide-vue-next'
import type { ToolCall } from '../types'

const props = defineProps<{ tool: ToolCall }>()
const open = ref(false)
const copied = ref(false)
const elapsedMs = ref(Date.now())
let ticker: number | undefined

const icon = computed(() => {
  const map = {
    read_file: FileText,
    write_file: PenLine,
    list_files: FolderOpen,
    grep: Search,
    execute_command: TerminalSquare,
    git_status: GitBranch,
    git_commit: GitCommit,
    web_fetch: Globe
  }
  return map[props.tool.kind] ?? FilePlus2
})

const stateCopy = computed(() => {
  if (props.tool.state === 'running') return '执行中'
  if (props.tool.state === 'pending') return '排队中'
  if (props.tool.failed) return '失败'
  return '完成'
})

const elapsedLabel = computed(() => {
  if (props.tool.state !== 'running' && props.tool.state !== 'pending') return ''
  const seconds = Math.floor((Date.now() - elapsedMs.value) / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m${String(seconds % 60).padStart(2, '0')}s`
})

const progressLabel = computed(() => {
  if (props.tool.state !== 'pending') return ''
  const chars = props.tool.progressChars ?? 0
  const human = chars > 1024 ? `${(chars / 1024).toFixed(1)} KB` : `${chars} B`
  if (props.tool.kind === 'write_file') return `正在生成文件内容（${human}）…`
  if (props.tool.kind === 'grep') return `正在理解搜索条件…`
  return `正在准备调用参数（${human}）…`
})

watch(
  () => props.tool.state,
  (state) => {
    if (state === 'running' || state === 'pending') {
      if (!ticker) elapsedMs.value = Date.now()
      if (ticker) window.clearInterval(ticker)
      ticker = window.setInterval(() => {
        elapsedMs.value = Date.now()
      }, 1000)
    } else if (ticker) {
      window.clearInterval(ticker)
      ticker = undefined
    }
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  if (ticker) window.clearInterval(ticker)
})

const diffLines = computed<Array<{ cls: string; text: string }>>(() => {
  const raw = props.tool.diff ?? ''
  return raw.split('\n').map((line) => {
    let cls = ''
    if (line.startsWith('+') && !line.startsWith('+++')) cls = 'add'
    else if (line.startsWith('-') && !line.startsWith('---')) cls = 'del'
    else if (line.startsWith('@@')) cls = 'hunk'
    return { cls, text: line }
  })
})

async function copyOutput(): Promise<void> {
  if (!props.tool.output) return
  try {
    await navigator.clipboard.writeText(props.tool.output)
    copied.value = true
    setTimeout(() => (copied.value = false), 1400)
  } catch {
    // Clipboard may be unavailable; leaving the text selectable is enough.
  }
}
</script>

<template>
  <div class="tool-call" :class="tool.state">
    <button class="tool-row" type="button" :disabled="tool.state === 'pending'" @click="open = !open">
      <span class="tool-icon"><component :is="icon" :size="14" /></span>
      <span class="tool-copy">
        <strong>{{ tool.title }}</strong>
        <code v-if="tool.command">{{ tool.command }}</code>
        <span v-if="progressLabel" class="tool-pending-line">{{ progressLabel }}</span>
      </span>
      <span class="state-chip" :class="[tool.state, { failed: tool.failed }]">
        <span v-if="tool.state === 'running'" class="mini-dot pulse"></span>
        <AlertTriangle v-else-if="tool.failed" :size="12" />
        <Check v-else-if="tool.state === 'done'" :size="12" />
        <span v-else class="mini-dot"></span>
        {{ stateCopy }}<span v-if="elapsedLabel" class="elapsed">{{ elapsedLabel }}</span>
      </span>
      <ChevronDown v-if="tool.output || tool.diff" class="chevron" :class="{ open }" :size="14" />
    </button>

    <div v-if="open && (tool.output || tool.diff)" class="tool-details">
      <div v-if="tool.diff" class="diff-block">
        <div class="output-head"><span>变更预览</span></div>
        <div class="diff-scroll">
          <div v-for="(line, index) in diffLines" :key="index" class="diff-line" :class="line.cls">
            <code>{{ line.text }}</code>
          </div>
        </div>
      </div>
      <div v-if="tool.output" class="tool-output">
        <div class="output-head">
          <span>输出</span>
          <button class="copy-btn" type="button" @click.stop="copyOutput">
            <Check v-if="copied" :size="12" />
            <Copy v-else :size="12" />
            {{ copied ? '已复制' : '复制' }}
          </button>
        </div>
        <pre>{{ tool.output }}</pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tool-call {
  position: relative;
  border: 0;
  border-left: 2px solid var(--border);
  border-radius: 8px;
  background: rgba(28, 37, 34, 0.02);
  overflow: hidden;
}

.tool-call.running {
  border-left-color: var(--accent);
  background: var(--accent-soft);
}

.tool-call.done {
  border-left-color: var(--teal);
}

.tool-call.failed {
  border-left-color: var(--danger);
}

.tool-row:not(:disabled):hover {
  background: var(--bg-soft);
}

.tool-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  text-align: left;
  color: var(--text-secondary);
}

.tool-row:disabled {
  cursor: default;
  opacity: 0.55;
}

.tool-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  flex: none;
  border-radius: var(--radius-s);
  background: rgba(28, 37, 34, 0.06);
  color: var(--text-muted);
}

.tool-call.running .tool-icon {
  background: var(--accent-soft);
  color: var(--accent);
}

.tool-call.done .tool-icon {
  background: var(--teal-soft);
  color: var(--teal);
}

.tool-call.failed .tool-icon {
  background: rgba(217, 67, 67, 0.1);
  color: var(--danger);
}

.tool-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.tool-copy strong {
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
}

.tool-copy code {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
}

.tool-pending-line {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--accent);
  font-size: 10px;
}

.state-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
  color: var(--text-muted);
  font-size: 11px;
}

.state-chip.running {
  color: var(--accent);
}

.state-chip.done {
  color: var(--teal);
}

.state-chip.failed {
  color: var(--danger);
}

.elapsed {
  padding-left: 5px;
  color: var(--text-muted);
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

.chevron {
  flex: none;
  color: var(--text-muted);
  transition: transform 0.16s ease;
}

.chevron.open {
  transform: rotate(180deg);
}

.diff-block {
  border-top: 1px solid var(--border);
}

.diff-scroll {
  max-height: 240px;
  overflow: auto;
  padding: 4px 10px 8px 28px;
}

.diff-line {
  min-height: 18px;
  padding: 1px 6px;
  margin-top: 2px;
  border-radius: 2px;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}

.diff-line code {
  font: inherit;
}

.diff-line.add {
  background: rgba(15, 133, 118, 0.09);
  color: var(--teal);
}

.diff-line.del {
  background: rgba(217, 67, 67, 0.09);
  color: var(--danger);
}

.diff-line.hunk {
  color: var(--text-muted);
  font-weight: 600;
}

.tool-output {
  border-top: 1px solid var(--border);
}

.output-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
}

.copy-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 3px;
  color: var(--text-muted);
  font-family: var(--font-sans);
  font-size: 10px;
}

.copy-btn:hover {
  background: rgba(28, 37, 34, 0.07);
  color: var(--text);
}

pre {
  max-height: 220px;
  margin: 0 0 8px 28px;
  padding: 8px 10px;
  overflow: auto;
  color: #2b3531;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
