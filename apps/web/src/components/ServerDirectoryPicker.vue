<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ArrowUp, Check, File, Folder, FolderOpen, RefreshCcw, X } from 'lucide-vue-next'
import { formatSize, listDirectory, type DirectoryEntry } from '../services/directory'

const props = defineProps<{ currentPath?: string }>()
const emit = defineEmits<{ select: [path: string]; close: [] }>()

const pathInput = ref(props.currentPath ?? '')
const currentPath = ref('')
const parent = ref<string | null>(null)
const entries = ref<DirectoryEntry[]>([])
const busy = ref(false)
const error = ref('')

async function load(path: string): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = ''
  entries.value = []
  try {
    const listing = await listDirectory(path)
    currentPath.value = listing.path
    pathInput.value = listing.path
    parent.value = listing.parent
    entries.value = listing.entries
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '读取目录失败。'
  } finally {
    busy.value = false
  }
}

function openFolder(entry: DirectoryEntry): void {
  if (entry.kind === 'directory') void load(entry.path)
}

function goUp(): void {
  if (parent.value) void load(parent.value)
}

function goRoot(): void {
  void load('')
}

async function confirm(): Promise<void> {
  const typed = pathInput.value.trim()
  if (typed && typed !== currentPath.value) {
    try {
      await load(typed)
    } catch {
      return
    }
  }
  if (currentPath.value) {
    emit('select', currentPath.value)
    emit('close')
  }
}

onMounted(() => load(props.currentPath ?? ''))
</script>

<template>
  <div class="picker-overlay" @click.self="emit('close')">
    <div class="picker-dialog" role="dialog" aria-label="选择服务器目录">
      <header class="picker-head">
        <div>
          <h2>选择服务器目录</h2>
          <p>读取的是运行 ExitcodeAgent 的服务器文件系统。</p>
        </div>
        <button class="icon-btn" type="button" aria-label="关闭目录选择" @click="emit('close')">
          <X :size="18" />
        </button>
      </header>

      <div class="picker-body">
        <div class="picker-toolbar">
          <input
            v-model="pathInput"
            class="field path-input"
            type="text"
            placeholder="服务器目录路径"
            @keydown.enter.prevent="load(pathInput)"
          />
          <button class="icon-btn" type="button" aria-label="读取路径" title="读取路径" @click="load(pathInput)">
            <RefreshCcw :size="16" :class="{ spinning: busy }" />
          </button>
        </div>

        <div class="picker-nav">
          <button class="btn-ghost small" type="button" @click="goRoot"><FolderOpen :size="14" />根目录</button>
          <button class="btn-ghost small" type="button" :disabled="!parent" @click="goUp"><ArrowUp :size="14" />上级</button>
          <span v-if="currentPath" class="current-path">{{ currentPath }}</span>
        </div>

        <div class="picker-list-wrap">
          <div v-if="busy" class="picker-state">正在读取目录</div>
          <div v-else-if="error" class="picker-state error">{{ error }}</div>
          <div v-else-if="entries.length" class="picker-list">
            <button
              v-for="entry in entries"
              :key="entry.path"
              class="picker-row"
              :class="{ file: entry.kind === 'file' }"
              type="button"
              :disabled="entry.kind === 'file'"
              @click="openFolder(entry)"
            >
              <Folder v-if="entry.kind === 'directory'" :size="16" />
              <File v-else :size="16" />
              <span class="row-name">{{ entry.name }}</span>
              <small v-if="entry.kind === 'file'">{{ formatSize(entry.size) }}</small>
            </button>
          </div>
          <div v-else class="picker-state">目录是空的。</div>
        </div>
      </div>

      <footer class="picker-foot">
        <button class="btn-ghost" type="button" @click="emit('close')">取消</button>
        <button class="btn-primary" type="button" :disabled="busy || !currentPath" @click="confirm">
          <Check :size="15" />
          使用当前目录
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.picker-overlay {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(28, 37, 34, 0.34);
  backdrop-filter: blur(4px);
}

.picker-dialog {
  display: flex;
  flex-direction: column;
  width: min(620px, 100%);
  max-height: calc(100vh - 48px);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-m);
  background: var(--bg-soft);
  box-shadow: var(--shadow-pop);
}

.picker-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px 12px;
  border-bottom: 1px solid var(--border);
}

.picker-head h2 {
  margin: 0 0 3px;
  font-size: 16px;
}

.picker-head p {
  color: var(--text-muted);
  font-size: 12px;
}

.picker-body {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 14px 18px;
}

.picker-toolbar {
  display: flex;
  gap: 8px;
}

.path-input {
  flex: 1;
  font-family: var(--font-mono);
  font-size: 12px;
}

.picker-nav {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 10px 0;
}

.btn-ghost.small {
  min-height: 28px;
  padding: 4px 9px;
  font-size: 12px;
}

.current-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-left: auto;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
}

.picker-list-wrap {
  flex: 1;
  min-height: 220px;
  max-height: 46vh;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-s);
  background: var(--bg);
}

.picker-state {
  padding: 30px 16px;
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
}

.picker-state.error {
  color: var(--danger);
}

.picker-list {
  display: flex;
  flex-direction: column;
}

.picker-row {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-height: 36px;
  padding: 7px 12px;
  text-align: left;
  color: var(--text-secondary);
}

.picker-row + .picker-row {
  border-top: 1px solid rgba(28, 37, 34, 0.06);
}

.picker-row:not(:disabled):hover {
  background: var(--accent-soft);
  color: var(--text);
}

.picker-row:disabled {
  cursor: default;
  opacity: 0.85;
}

.picker-row.file {
  color: var(--text-muted);
}

.picker-row svg {
  color: var(--accent);
  flex: none;
}

.picker-row.file svg {
  color: var(--text-muted);
}

.row-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1;
  font-family: var(--font-mono);
  font-size: 12px;
}

.picker-row small {
  flex: none;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
}

.picker-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px 14px;
  border-top: 1px solid var(--border);
}

.spinning {
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 640px) {
  .picker-overlay {
    padding: 0;
  }

  .picker-dialog {
    height: 100%;
    max-height: 100%;
    border: 0;
    border-radius: 0;
  }
}
</style>
