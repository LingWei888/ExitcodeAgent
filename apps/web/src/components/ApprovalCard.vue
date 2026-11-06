<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { AlertTriangle, Check, Copy, Folder, ShieldCheck } from 'lucide-vue-next'

export interface PendingApproval {
  approvalId: string
  toolId: string
  command: string
  cwd: string
  detail: string
  timeoutAt: number
  submitted?: boolean
}

const props = defineProps<{ approval: PendingApproval; busy: boolean }>()
const emit = defineEmits<{ approve: []; reject: [] }>()

const now = ref(Date.now())
let timer: number | undefined
timer = window.setInterval(() => {
  now.value = Date.now()
}, 1000)
onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer)
})

const copied = ref(false)
const expired = computed(() => !props.approval.submitted && now.value > props.approval.timeoutAt)
const remainLabel = computed(() => {
  const remain = Math.max(0, Math.round((props.approval.timeoutAt - now.value) / 1000))
  const minutes = Math.floor(remain / 60)
  const seconds = remain % 60
  return `${minutes}分${String(seconds).padStart(2, '0')}秒`
})

async function copyCommand(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.approval.command)
    copied.value = true
    setTimeout(() => (copied.value = false), 1400)
  } catch {
    // 剪贴板不可用时命令仍可选中复制
  }
}
</script>

<template>
  <div class="approval-card" :class="{ submitted: approval.submitted }">
    <div class="approval-head">
      <span class="approval-icon"><ShieldCheck :size="14" /></span>
      <strong>{{ approval.submitted ? '已同意，正在执行命令…' : expired ? '审批超时，命令未执行' : '等待你批准执行命令' }}</strong>
      <span v-if="!approval.submitted" class="approval-countdown" :class="{ danger: expired }">
        <AlertTriangle v-if="expired" :size="11" />
        {{ expired ? '已超时' : `${remainLabel}后自动拒绝` }}
      </span>
    </div>
    <p v-if="approval.detail && !approval.submitted" class="approval-detail">{{ approval.detail }}</p>
    <div class="approval-command">
      <code>{{ approval.command }}</code>
      <button v-if="!approval.submitted" class="copy-btn" type="button" @click="copyCommand">
        <Check v-if="copied" :size="11" />
        <Copy v-else :size="11" />
        {{ copied ? '已复制' : '复制' }}
      </button>
    </div>
    <p class="approval-cwd"><Folder :size="11" /> 执行目录：{{ approval.cwd || '工作区根目录' }}</p>
    <div v-if="!approval.submitted" class="approval-actions">
      <button class="btn-reject" type="button" :disabled="busy" @click="emit('reject')">拒绝</button>
      <span class="hint">命令会在工作区里以你的身份执行</span>
      <button class="btn-approve" type="button" :disabled="busy || expired" @click="emit('approve')">同意执行</button>
    </div>
  </div>
</template>

<style scoped>
.approval-card {
  border: 1px solid rgba(15, 133, 118, 0.35);
  border-left: 3px solid var(--accent);
  border-radius: 10px;
  background: var(--bg-soft);
  padding: 12px 14px;
  box-shadow: var(--shadow-pop, 0 8px 24px rgba(0, 0, 0, 0.12));
}

.approval-card.submitted {
  opacity: 0.85;
}

.approval-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.approval-head strong {
  font-size: 13px;
  color: var(--text);
}

.approval-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-s);
  background: var(--accent-soft);
  color: var(--accent);
}

.approval-countdown {
  margin-left: auto;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.approval-countdown.danger {
  color: var(--danger);
}

.approval-detail {
  margin: 8px 0 0;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.5;
}

.approval-command {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
}

.approval-command code {
  min-width: 0;
  flex: 1;
  overflow-x: auto;
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
}

.copy-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
  padding: 3px 7px;
  border-radius: 4px;
  color: var(--text-muted);
  font-size: 10px;
}

.copy-btn:hover {
  background: rgba(28, 37, 34, 0.07);
  color: var(--text);
}

.approval-cwd {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 7px 0 0;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
}

.approval-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
}

.approval-actions .btn-approve {
  margin-left: auto;
  padding: 6px 16px;
  border-radius: 999px;
  background: var(--accent);
  color: #ffffff;
  font-size: 12px;
  font-weight: 700;
}

.approval-actions .btn-approve:hover {
  background: var(--accent-hover);
}

.approval-actions .btn-reject {
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg);
  color: var(--text-secondary);
  font-size: 12px;
}

.approval-actions .btn-reject:hover {
  border-color: var(--danger);
  color: var(--danger);
}

.approval-actions .btn-approve:disabled,
.approval-actions .btn-reject:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.approval-actions .hint {
  color: var(--text-muted);
  font-size: 10px;
}
</style>