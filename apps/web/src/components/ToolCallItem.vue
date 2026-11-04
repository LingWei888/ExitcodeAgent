<script setup lang="ts">
import { computed, ref } from 'vue'
import {
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
  return '完成'
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
      </span>
      <span class="state-chip" :class="tool.state">
        <span v-if="tool.state === 'running'" class="mini-dot pulse"></span>
        <Check v-else-if="tool.state === 'done'" :size="12" />
        <span v-else class="mini-dot"></span>
        {{ stateCopy }}
      </span>
      <ChevronDown v-if="tool.output" class="chevron" :class="{ open }" :size="14" />
    </button>

    <div v-if="open && tool.output" class="tool-output">
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
</template>

<style scoped>
.tool-call {
  border: 1px solid var(--border);
  border-radius: var(--radius-s);
  background: var(--bg-inset);
  overflow: hidden;
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
  background: rgba(245, 238, 227, 0.06);
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
  background: rgba(245, 238, 227, 0.07);
  color: var(--text);
}

pre {
  max-height: 220px;
  margin: 0;
  padding: 4px 10px 10px;
  overflow: auto;
  color: #d8d1c6;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
