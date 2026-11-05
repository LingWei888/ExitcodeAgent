<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { Check, FolderGit2, MessagesSquare, Plus, Radio, Trash2, X } from 'lucide-vue-next'
import { createSession, deleteProject, deleteSession, store } from '../store'
import { forkSessionFromMain } from '../services/api'

const mode = ref<'projects' | 'sessions'>('projects')
const addingSession = ref(false)
const newTitle = ref('')
const inputEl = ref<HTMLInputElement | null>(null)
const confirmingDelete = ref('')
let confirmTimer: number | undefined

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
    const session = createSession(title.length > 24 ? `${title.slice(0, 24)}…` : title)
    // 新分支统一从主分支分叉（全新空聊天）；服务端对未分叉过的会话也会惰性建分支兜底
    const directoryName = currentProject.value?.directoryName
    if (directoryName) {
      void forkSessionFromMain(session.id, directoryName).catch(() => {
        // 分支元数据写入失败不影响新建空会话
      })
    }
    mode.value = 'sessions'
  }
  addingSession.value = false
}

function requestDelete(kind: 'project' | 'session', id: string): void {
  if (confirmTimer) window.clearTimeout(confirmTimer)
  if (confirmingDelete.value === id) {
    confirmingDelete.value = ''
    if (kind === 'project') deleteProject(id)
    else deleteSession(id)
    return
  }
  confirmingDelete.value = id
  confirmTimer = window.setTimeout(() => {
    confirmingDelete.value = ''
  }, 3000)
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
          <span class="head-right">
            <span class="count">{{ store.projects.length }}</span>
            <button class="add-button" type="button" aria-label="新建项目" @click="store.showProjectForm = true">
              <Plus :size="15" />
            </button>
          </span>
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
          <span
            class="item-del"
            :class="{ confirm: confirmingDelete === project.id }"
            role="button"
            :title="confirmingDelete === project.id ? '再次点击确认删除' : '删除项目（仅删除记录，不删服务器文件）'"
            @click.stop="requestDelete('project', project.id)"
          >
            <Trash2 :size="13" />
          </span>
        </button>

        <div v-if="!store.projects.length" class="empty-note">
          还没有项目，先新建一个。
          <button class="create-btn" type="button" @click="store.showProjectForm = true">新建项目</button>
        </div>
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
          <span
            class="item-del"
            :class="{ confirm: confirmingDelete === session.id }"
            role="button"
            :title="confirmingDelete === session.id ? '再次点击确认删除' : '删除会话（仅删除记录，不删服务器文件）'"
            @click.stop="requestDelete('session', session.id)"
          >
            <Trash2 :size="13" />
          </span>
        </button>

        <div v-if="!sessionList.length && !addingSession" class="empty-note">这个项目还没有会话。</div>
      </section>
    </div>

    <div class="sidebar-foot">
      <div class="foot-row">
        <span class="dot"></span>
        <span>服务器运行</span>
      </div>
      <div class="foot-row muted">
        <span>会话数据</span>
        <strong>服务器保存</strong>
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

.item-del {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex: none;
  border-radius: var(--radius-s);
  opacity: 0;
  color: var(--text-muted);
  cursor: pointer;
}

.project-item:hover .item-del,
.session-item:hover .item-del,
.item-del.confirm {
  opacity: 1;
}

.item-del:hover {
  background: rgba(217, 67, 67, 0.1);
  color: var(--danger);
}

.item-del.confirm {
  background: rgba(217, 67, 67, 0.14);
  color: var(--danger);
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


.head-right {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.create-btn {
  width: 100%;
  margin-top: 8px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-s);
  background: var(--bg-raised);
  color: var(--text);
  font-size: 12px;
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
