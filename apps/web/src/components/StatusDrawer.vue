<script setup lang="ts">
import { computed } from 'vue'
import {
  Activity,
  Bot,
  Braces,
  FileDiff,
  GitBranch,
  TerminalSquare,
  X,
  Zap
} from 'lucide-vue-next'
import { currentSession, store } from '../store'
import type { ToolCall } from '../types'

const session = computed(() => currentSession())

const commands = computed<ToolCall[]>(() =>
  session.value.messages
    .flatMap((message) => message.tools)
    .filter((tool) => tool.state === 'done' && tool.output)
    .slice(-6)
)

const fileKinds: Record<string, string> = {
  created: '新增',
  modified: '修改',
  deleted: '删除'
}

const currentModel = computed(() => store.models.find((m) => m.id === store.currentModelId))
</script>

<template>
  <aside class="drawer">
    <div class="drawer-head">
      <div>
        <h2>工作区状态</h2>
        <span class="drawer-sub">{{ session.title }}，{{ session.branch }}</span>
      </div>
      <button class="icon-btn close-toggle" type="button" aria-label="关闭状态面板" @click="store.mobileDrawerOpen = false">
        <X :size="17" />
      </button>
    </div>

    <div class="drawer-body">
      <section class="drawer-section">
        <div class="section-title"><FileDiff :size="14" /><span>本轮文件变更</span><span class="count">{{ session.filesChanged.length }}</span></div>
        <div v-if="session.filesChanged.length" class="file-list">
          <div v-for="file in session.filesChanged" :key="`${file.path}-${file.summary}`" class="file-row">
            <span class="file-badge" :class="file.kind">{{ fileKinds[file.kind] }}</span>
            <span class="file-copy">
              <strong>{{ file.path }}</strong>
              <small>{{ file.summary }}</small>
            </span>
          </div>
        </div>
        <div v-else class="empty-block">本会话还没有产生文件变更。</div>
      </section>

      <section class="drawer-section">
        <div class="section-title"><TerminalSquare :size="14" /><span>命令记录</span><span class="count">{{ commands.length }}</span></div>
        <div v-if="commands.length" class="cmd-list">
          <div v-for="tool in commands" :key="tool.id" class="cmd-row">
            <div class="cmd-line"><span class="prompt">$</span>{{ tool.command }}</div>
            <div class="cmd-meta">{{ tool.kind.replace('_', ' ') }}，{{ tool.output?.split('\n')[0] }}</div>
          </div>
        </div>
        <div v-else class="empty-block">执行过的命令会显示在这里。</div>
      </section>

      <section class="drawer-section">
        <div class="section-title"><Activity :size="14" /><span>本会话用量</span></div>
        <div class="stats-grid">
          <div class="stat">
            <span class="stat-icon"><Braces :size="15" /></span>
            <div><strong>{{ session.runTokens.input.toLocaleString() }}</strong><small>输入 token</small></div>
          </div>
          <div class="stat">
            <span class="stat-icon"><Zap :size="15" /></span>
            <div><strong>{{ session.runTokens.output.toLocaleString() }}</strong><small>输出 token</small></div>
          </div>
        </div>
      </section>

      <section class="drawer-section">
        <div class="section-title"><Bot :size="14" /><span>模型连接</span></div>
        <div class="model-card">
          <div class="model-card-head">
            <span class="dot"></span>
            <strong>{{ currentModel?.label }}</strong>
            <span class="status-pill">mock</span>
          </div>
          <div class="model-card-row"><span>提供方</span><code>{{ currentModel?.provider }}</code></div>
          <div class="model-card-row"><span>模型</span><code>{{ currentModel?.model }}</code></div>
          <div class="model-card-row"><span>接入</span><span class="link-line">演示模拟器</span></div>
          <div class="model-card-row"><span>分支</span><span class="link-line"><GitBranch :size="12" /> {{ session.branch }}</span></div>
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
  font-size: 13px;
}

.status-pill {
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(28, 37, 34, 0.08);
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 10px;
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
