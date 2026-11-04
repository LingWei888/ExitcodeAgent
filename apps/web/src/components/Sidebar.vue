<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { Check, FolderGit2, MessagesSquare, Plus, Radio, X } from 'lucide-vue-next'
import { createSession, store } from '../store'

const mode = ref<'projects' | 'sessions'>('projects')
const addingSession = ref(false)
const newTitle = ref('')
const inputEl = ref<HTMLInputElement | null>(null)

const currentProject = computed(() => store.projects.find((p) => p.id === store.currentProjectId))
const sessionList = computed(() =>
  (currentProject.value?.sessionIds ?? [])
    .map((id) => store.sessions[id])
    .filter(Boolean)
)

function selectProject(id: string): void {
  if (store.currentProjectId === id) return
  store.currentProjectId = id
  const first = store.projects.find((p) => p.id === id)?.sessionIds[0] ?? ''
  store.currentSessionId = store.sessions[first] ? first : ''
}

async function startAddSession(): Promise<void> {
  addingSession.value = true
  newTitle.value = ''
  await nextTick()
  inputEl.value?.focus()
}

function commitSession(): void {
  const title = newTitle.value.trim()
  if (title) {
    createSession(title.length > 24 ? `${title.slice(0, 24)}…` : title)
    mode.value = 'sessions'
  }
  addingSession.value = false
}
</script>

<template>
  <aside class="sidebar">
    <div class="segmented">
      <button :class="{ active: mode === 'projects' }" type="button" @click="mode = 'projects'">
        <FolderGit2 :size="15" />
        <span>项目</span>
      </button>
      <button :class="{ active: mode === 'sessions' }" type="button" @click="mode = 'sessions'">
        <MessagesSquare :size="15" />
        <span>会话</span>
      </button>
    </div>

    <div class="scroll-area">
      <section v-if="mode === 'projects'" class="list-section">
        <div class="section-head">
          <span>工作区项目</span>
          <span class="count">{{ store.projects.length }}</span>
        </div>
        <button
          v-for="project in store.projects"
          :key="project.id"
          class="project-item"
          :class="{ active: project.id === store.currentProjectId }"
          type="button"
          @click="selectProject(project.id)"
        >
          <span class="project-icon"><FolderGit2 :size="16" /></span>
          <span class="project-copy">
            <strong>{{ project.name }}</strong>
            <small>{{ project.description }}</small>
          </span>
          <span class="active-check"><Check :size="13" /></span>
        </button>
      </section>

      <section v-else class="list-section">
        <div class="section-head">
          <span>{{ currentProject?.name ?? '会话' }}</span>
          <button class="add-button" type="button" aria-label="新建会话" @click="startAddSession">
            <Plus :size="15" />
          </button>
        </div>

        <div v-if="addingSession" class="inline-add">
          <input
            ref="inputEl"
            v-model="newTitle"
            class="field inline-input"
            type="text"
            placeholder="会话标题"
            @keydown.enter.prevent="commitSession"
            @keydown.esc="addingSession = false"
          />
          <button class="icon-btn" type="button" aria-label="确认" @click="commitSession"><Check :size="15" /></button>
          <button class="icon-btn" type="button" aria-label="取消" @click="addingSession = false"><X :size="15" /></button>
        </div>

        <button
          v-for="session in sessionList"
          :key="session.id"
          class="session-item"
          :class="{ active: session.id === store.currentSessionId }"
          type="button"
          @click="store.currentSessionId = session.id"
        >
          <span class="session-icon"><Radio :size="14" /></span>
          <span class="session-copy">
            <strong>{{ session.title }}</strong>
            <small>{{ session.updatedAt }} ，{{ session.messages.length }} 条消息</small>
          </span>
        </button>

        <div v-if="!sessionList.length && !addingSession" class="empty-note">这个项目还没有会话。</div>
      </section>
    </div>

    <div class="sidebar-foot">
      <div class="foot-row">
        <span class="dot"></span>
        <span>本地沙箱演示</span>
      </div>
      <div class="foot-row muted">
        <span>会话隔离</span>
        <strong>容器级</strong>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  width: 264px;
  flex: none;
  border-right: 1px solid var(--border);
  background: var(--bg-soft);
}

.segmented {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 3px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
}

.segmented button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 32px;
  border-radius: var(--radius-s);
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 600;
}

.segmented button.active {
  background: var(--bg-raised);
  color: var(--text);
}

.scroll-area {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.list-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 4px 8px;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 600;
}

.count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: rgba(28, 37, 34, 0.07);
  font-size: 11px;
}

.project-item,
.session-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-s);
  text-align: left;
  color: var(--text-secondary);
}

.project-item:hover,
.session-item:hover {
  background: rgba(28, 37, 34, 0.04);
}

.project-item.active,
.session-item.active {
  border-color: rgba(255, 106, 43, 0.28);
  background: var(--accent-soft);
}

.project-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  flex: none;
  border-radius: var(--radius-s);
  background: rgba(28, 37, 34, 0.06);
  color: var(--text-secondary);
}

.project-item.active .project-icon {
  background: var(--accent);
  color: #1b0d04;
}

.project-copy,
.session-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.project-copy strong,
.session-copy strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
}

.project-copy small,
.session-copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
  font-size: 11px;
}

.active-check {
  display: none;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex: none;
  border-radius: 50%;
  background: var(--accent);
  color: #1b0d04;
}

.project-item.active .active-check {
  display: inline-flex;
}

.add-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: var(--radius-s);
  color: var(--text-secondary);
}

.add-button:hover {
  background: rgba(28, 37, 34, 0.08);
  color: var(--text);
}

.inline-add {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 4px 8px;
}

.inline-input {
  min-width: 0;
  flex: 1;
  min-height: 32px;
  padding: 6px 9px;
  font-size: 12px;
}

.session-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex: none;
  border-radius: var(--radius-s);
  color: var(--text-muted);
}

.session-item.active .session-icon {
  color: var(--accent);
}

.empty-note {
  padding: 10px;
  color: var(--text-muted);
  font-size: 12px;
}

.sidebar-foot {
  padding: 12px;
  border-top: 1px solid var(--border);
}

.foot-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 2px;
  font-size: 12px;
  color: var(--text-secondary);
}

.foot-row.muted {
  justify-content: space-between;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
}

.foot-row strong {
  color: var(--teal);
  font-weight: 600;
}
</style>
