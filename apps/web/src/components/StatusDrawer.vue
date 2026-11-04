<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  Activity,
  Bot,
  Braces,
  File,
  Folder,
  FolderOpen,
  FolderPlus,
  RefreshCcw,
  TerminalSquare,
  X,
  Zap
} from 'lucide-vue-next'
import { currentConnection, currentProject, currentSession, store } from '../store'
import {
  ensureReadPermission,
  formatSize,
  getDirectoryHandle,
  isDirectoryPickerSupported,
  listDirectory,
  pickProjectDirectory,
  saveDirectoryHandle
} from '../services/directory'
import type { DirectoryEntry } from '../services/directory'
import type { Session, ToolCall } from '../types'

const session = computed<Session | null>(() => currentSession())
const project = computed(() => currentProject())
const connection = computed(() => currentConnection())

const commands = computed<ToolCall[]>(() =>
  (session.value?.messages ?? [])
    .flatMap((message) => message.tools)
    .filter((tool) => tool.state === 'done' && tool.output)
    .slice(-6)
)

const fileChanges = computed(() => session.value?.filesChanged ?? [])
const runTokens = computed(() => session.value?.runTokens ?? { input: 0, output: 0 })

const kindLabels: Record<string, string> = {
  modified: '修改',
  created: '新增',
  deleted: '删除'
}

const toolLabels: Record<string, string> = {
  read_file: '读取文件',
  write_file: '写入文件',
  list_files: '列出文件',
  grep: '搜索代码',
  execute_command: '执行命令',
  git_status: 'Git 状态',
  git_commit: 'Git 提交',
  web_fetch: '抓取网页'
}

function kindLabel(kind: string): string {
  return kindLabels[kind] ?? kind
}

function toolLabel(kind: string): string {
  return toolLabels[kind] ?? kind.replace(/_/g, ' ')
}

const files = ref<DirectoryEntry[]>([])
const directoryName = ref('')
const dirMessage = ref('')
const dirBusy = ref(false)
const dirSupported = isDirectoryPickerSupported()

async function refreshDirectory(): Promise<void> {
  const current = project.value
  files.value = []
  dirMessage.value = ''
  directoryName.value = current?.directoryName ?? ''
  if (!current) return
  if (!dirSupported) {
    dirMessage.value = '当前浏览器不支持读取目录，请使用 Chrome 或 Edge。'
    return
  }
  dirBusy.value = true
  try {
    const handle = await getDirectoryHandle(current.id)
    if (!handle) {
      dirMessage.value = current.directoryName ? '目录授权已失效，需要重新选择。' : '还没有关联目录。'
      return
    }
    const permitted = await ensureReadPermission(handle)
    if (permitted !== 'granted') {
      dirMessage.value = '需要重新授予目录读取权限。'
      return
    }
    directoryName.value = current.directoryName || handle.name
    files.value = await listDirectory(handle)
    if (!files.value.length) dirMessage.value = '目录是空的。'
  } catch {
    files.value = []
    dirMessage.value = '读取目录失败，可以重新选择。'
  } finally {
    dirBusy.value = false
  }
}

async function chooseDirectory(): Promise<void> {
  if (!dirSupported || dirBusy.value) return
  const current = project.value
  if (!current) return
  try {
    const picked = await pickProjectDirectory()
    await saveDirectoryHandle(current.id, picked.handle)
    current.directoryName = picked.name
    current.directoryPickedAt = new Date().toISOString()
    await refreshDirectory()
  } catch (cause) {
    if (cause instanceof Error && cause.name !== 'AbortError') {
      dirMessage.value = cause.message || '选择目录失败。'
      directoryName.value = current.directoryName ?? ''
    }
  }
}

onMounted(refreshDirectory)
watch(() => store.currentProjectId, refreshDirectory)
</script>

<template>
  <aside class="drawer">
    <div class="drawer-head">
      <div>
        <h2>工作区状态</h2>
        <span class="drawer-sub">{{ session?.title ?? '未选择会话' }}，{{ project?.name ?? '未选择项目' }}</span>
      </div>
      <button class="icon-btn close-toggle" type="button" aria-label="关闭状态面板" @click="store.mobileDrawerOpen = false">
        <X :size="17" />
      </button>
    </div>

    <div class="drawer-body">
      <section class="drawer-section">
        <div class="section-title">
          <FolderOpen :size="14" />
          <span>项目目录</span>
          <span v-if="project?.directoryName" class="count">{{ project.directoryName }}</span>
        </div>

        <div v-if="project" class="dir-card">
          <div class="dir-card-head">
            <div class="dir-card-copy">
              <strong>{{ project.name }}</strong>
              <small>{{ project.description || '没有描述' }}</small>
            </div>
            <button
              v-if="project.directoryName && dirSupported"
              class="refresh-btn"
              type="button"
              :disabled="dirBusy"
              title="刷新目录"
              aria-label="刷新目录"
              @click="refreshDirectory"
            >
              <RefreshCcw :size="14" :class="{ spinning: dirBusy }" />
            </button>
          </div>

          <div class="dir-actions">
            <button class="pick-btn" type="button" :disabled="!dirSupported || dirBusy" @click="chooseDirectory">
              <FolderPlus :size="14" />
              {{ project.directoryName ? '更换目录' : '选择服务器目录' }}
            </button>
          </div>

          <p v-if="project.directoryName" class="dir-name">
            <Folder :size="13" />
            {{ directoryName || project.directoryName }}
          </p>
          <p v-if="dirMessage" class="dir-message">{{ dirMessage }}</p>

          <div v-if="files.length" class="dir-list">
            <div v-for="entry in files.slice(0, 24)" :key="`${entry.kind}-${entry.name}`" class="dir-entry">
              <File v-if="entry.kind === 'file'" :size="13" />
              <Folder v-else :size="13" />
              <span class="entry-name">{{ entry.name }}</span>
              <small v-if="entry.kind === 'file'">{{ formatSize(entry.size) }}</small>
            </div>
            <div v-if="files.length > 24" class="dir-more">还有 {{ files.length - 24 }} 项未显示</div>
          </div>

          <p v-if="!dirSupported" class="dir-message">需要 Chrome 或 Edge 才能选择并读取本地目录。</p>
        </div>

        <div v-else class="empty-block">先选择或创建一个项目，再关联它的目录。</div>
      </section>

      <section class="drawer-section">
        <div class="section-title">
          <Activity :size="14" />
          <span>本轮文件变更</span>
          <span class="count">{{ fileChanges.length }}</span>
        </div>
        <div v-if="fileChanges.length" class="file-list">
          <div v-for="file in fileChanges" :key="`${file.path}-${file.summary}`" class="file-row">
            <span class="file-badge" :class="file.kind">{{ kindLabel(file.kind) }}</span>
            <span class="file-copy">
              <strong>{{ file.path }}</strong>
              <small>{{ file.summary }}</small>
            </span>
          </div>
        </div>
        <div v-else class="empty-block">会话产生的文件变更会记录在这里。</div>
      </section>

      <section class="drawer-section">
        <div class="section-title">
          <TerminalSquare :size="14" />
          <span>命令记录</span>
          <span class="count">{{ commands.length }}</span>
        </div>
        <div v-if="commands.length" class="cmd-list">
          <div v-for="tool in commands" :key="tool.id" class="cmd-row">
            <div class="cmd-line"><span class="prompt">$</span>{{ tool.command }}</div>
            <div class="cmd-meta">{{ toolLabel(tool.kind) }}，{{ tool.output?.split('\n')[0] }}</div>
          </div>
        </div>
        <div v-else class="empty-block">执行过的命令会显示在这里。</div>
      </section>

      <section class="drawer-section">
        <div class="section-title"><Braces :size="14" /><span>本会话用量</span></div>
        <div class="stats-grid">
          <div class="stat">
            <span class="stat-icon"><Braces :size="15" /></span>
            <div><strong>{{ runTokens.input.toLocaleString() }}</strong><small>输入 token</small></div>
          </div>
          <div class="stat">
            <span class="stat-icon"><Zap :size="15" /></span>
            <div><strong>{{ runTokens.output.toLocaleString() }}</strong><small>输出 token</small></div>
          </div>
        </div>
      </section>

      <section class="drawer-section">
        <div class="section-title"><Bot :size="14" /><span>模型连接</span></div>
        <div v-if="connection" class="model-card">
          <div class="model-card-head">
            <span class="status-pill online">直连</span>
            <strong>{{ connection.label }}</strong>
          </div>
          <div class="model-card-row">
            <span>模型</span>
            <code>{{ connection.model }}</code>
          </div>
          <div class="model-card-row">
            <span>接口</span>
            <code class="link-line">{{ connection.baseUrl }}</code>
          </div>
        </div>
        <div v-else class="model-card empty">
          <div class="model-card-head">
            <span class="status-pill">未配置</span>
            <strong>还没有模型接入</strong>
          </div>
          <p class="empty-connect">密钥保存在本机，配置后即可直连模型。</p>
          <button class="connect-btn" type="button" @click="store.showSettings = true">添加模型</button>
        </div>
      </section>
    </div>
  </aside>
</template>

<style scoped>
.drawer {
  display: flex;
  flex-direction: column;
  width: 308px;
  flex: none;
  border-left: 1px solid var(--border);
  background: var(--bg-soft);
}

.drawer-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 14px 14px 12px;
  border-bottom: 1px solid var(--border);
}

.drawer-head h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
}

.drawer-sub {
  color: var(--text-muted);
  font-size: 11px;
}

.close-toggle {
  display: none;
}

.drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 14px 20px;
}

.drawer-section {
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
}

.drawer-section:last-child {
  border-bottom: 0;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 10px;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.section-title .count {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 150px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 19px;
  height: 17px;
  padding: 0 5px;
  border-radius: 999px;
  background: rgba(28, 37, 34, 0.07);
  color: var(--text-muted);
  font-size: 10px;
}

.dir-card {
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-s);
  background: var(--bg-inset);
}

.dir-card-head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.dir-card-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.dir-card-copy strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.dir-card-copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
  font-size: 11px;
}

.refresh-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex: none;
  border-radius: var(--radius-s);
  color: var(--text-muted);
}

.refresh-btn:hover:not(:disabled) {
  background: rgba(28, 37, 34, 0.08);
  color: var(--text);
}

.refresh-btn:disabled {
  opacity: 0.5;
}

.spinning {
  animation: spin 0.9s linear infinite;
}

.dir-actions {
  margin-top: 9px;
}

.pick-btn,
.connect-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  min-height: 32px;
  border: 1px solid var(--border);
  border-radius: var(--radius-s);
  background: var(--bg-raised);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.pick-btn:hover:not(:disabled),
.connect-btn:hover {
  border-color: var(--accent);
  color: var(--text);
  background: var(--accent-soft);
}

.pick-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.dir-name {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 9px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--teal);
  font-family: var(--font-mono);
  font-size: 11px;
}

.dir-message {
  margin-top: 8px;
  color: var(--text-muted);
  font-size: 11px;
}

.dir-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 8px;
}

.dir-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 5px 6px;
  border-radius: var(--radius-s);
  color: var(--text-secondary);
  font-size: 11px;
}

.dir-entry:hover {
  background: rgba(28, 37, 34, 0.05);
}

.dir-entry svg {
  flex: none;
  color: var(--text-muted);
}

.entry-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  font-family: var(--font-mono);
  font-size: 10px;
}

.dir-entry small {
  flex: none;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
}

.dir-more {
  padding: 5px 6px;
  color: var(--text-muted);
  font-size: 10px;
}

.file-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.file-row {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 6px 4px;
  border-radius: var(--radius-s);
}

.file-row:hover {
  background: rgba(28, 37, 34, 0.04);
}

.file-badge {
  flex: none;
  min-width: 36px;
  padding: 1px 5px;
  border-radius: 999px;
  background: rgba(28, 37, 34, 0.08);
  color: var(--text-secondary);
  font-size: 10px;
  text-align: center;
}

.file-badge.created {
  background: var(--teal-soft);
  color: var(--teal);
}

.file-badge.modified {
  background: rgba(255, 106, 43, 0.14);
  color: #bd4713;
}

.file-badge.deleted {
  background: rgba(217, 67, 67, 0.1);
  color: var(--danger);
}

.file-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.file-copy strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
}

.file-copy small {
  color: var(--text-muted);
  font-size: 11px;
}

.cmd-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cmd-row {
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-s);
  background: var(--bg-inset);
}

.cmd-line {
  display: flex;
  align-items: baseline;
  gap: 7px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: 11px;
}

.prompt {
  color: var(--accent);
  font-weight: 700;
}

.cmd-meta {
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
  font-size: 10px;
}

.empty-block {
  padding: 8px 4px;
  color: var(--text-muted);
  font-size: 12px;
}

.stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.stat {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px;
  border: 1px solid var(--border);
  border-radius: var(--radius-s);
  background: var(--bg-inset);
}

.stat-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex: none;
  border-radius: var(--radius-s);
  background: rgba(28, 37, 34, 0.06);
  color: var(--text-secondary);
}

.stat > div {
  display: flex;
  flex-direction: column;
}

.stat strong {
  font-family: var(--font-mono);
  font-size: 13px;
}

.stat small {
  color: var(--text-muted);
  font-size: 10px;
}

.model-card {
  padding: 10px;
  border: 1px solid rgba(15, 133, 118, 0.28);
  border-radius: var(--radius-m);
  background: var(--teal-soft);
}

.model-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.model-card-head strong {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.status-pill {
  flex: none;
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(28, 37, 34, 0.08);
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 10px;
}

.status-pill.online {
  background: var(--teal);
  color: #ffffff;
}

.model-card.empty {
  background: rgba(169, 116, 16, 0.08);
  border-color: rgba(169, 116, 16, 0.24);
}

.empty-connect {
  margin-bottom: 9px;
  color: var(--text-muted);
  font-size: 12px;
}

.model-card-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 4px 0;
  color: var(--text-muted);
  font-size: 11px;
}

.model-card-row code {
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 10px;
}

.link-line {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 10px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 1050px) {
  .drawer {
    position: fixed;
    inset: 52px 0 0 auto;
    z-index: 30;
    height: calc(100% - 52px);
    box-shadow: var(--shadow-pop);
  }

  .close-toggle {
    display: inline-flex;
  }
}
</style>
