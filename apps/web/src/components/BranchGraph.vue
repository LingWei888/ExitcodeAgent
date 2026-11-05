<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Eraser, FileText, GitBranch, GitMerge, MessageSquare, Trash2, X } from 'lucide-vue-next'
import type { GraphBranch, GraphCommit, GraphFile } from '../services/api'
import { fetchRoundDiff, fetchSessionGraph, mergeSessionToMain } from '../services/api'
import { clearChat, deleteSession, store } from '../store'

const props = defineProps<{ open: boolean; workspace: string }>()
const emit = defineEmits<{ close: [] }>()

const loading = ref(false)
const error = ref('')
const msg = ref('')
const branches = ref<GraphBranch[]>([])
const main = ref<{ tipCommit: string | null; commits: GraphCommit[] } | null>(null)
const selectedSha = ref('')
const selectedBranch = ref('')
const patches = ref<Record<string, string>>({})
const diffLoading = ref(false)
const merging = ref(false)
const confirmingDelete = ref('')
let msgTimer: number | undefined
let deleteTimer: number | undefined

const LANE_W = 132
const ROW_H = 36
const PAD_TOP = 34
const PAD_BOTTOM = 30
const PALETTE = ['#0f8576', '#3b82f6', '#a855f7', '#d97706', '#dc2626', '#0891b2', '#65a30d', '#7c3aed']

function sessionTitle(sessionId: string): string {
  return store.sessions[sessionId]?.title ?? sessionId
}

function branchLabel(branch: GraphBranch): string {
  return branch.name && branch.name !== '' ? branch.name : sessionTitle(branch.sessionId)
}

function flash(message: string): void {
  msg.value = message
  if (msgTimer) window.clearTimeout(msgTimer)
  msgTimer = window.setTimeout(() => {
    msg.value = ''
  }, 4500)
}

// —— 数据准备：所有提交按 sha 索引（主链 + 各分支链共用），拿到全局 seq 时间轴
const allShas = computed(() => {
  const map = new Map<string, GraphCommit>()
  for (const c of main.value?.commits ?? []) map.set(c.sha, c)
  for (const b of branches.value) for (const c of b.commits) map.set(c.sha, c)
  return map
})

const seqRange = computed(() => {
  let min = Infinity
  let max = -Infinity
  for (const c of allShas.value.values()) {
    min = Math.min(min, c.seq)
    max = Math.max(max, c.seq)
  }
  if (!Number.isFinite(min)) return { min: 0, max: 0 }
  return { min, max }
})

function yOf(seq: number): number {
  return PAD_TOP + seq * ROW_H
}

const laneCount = computed(() => 1 + branches.value.length)
const svgWidth = computed(() => Math.max(360, laneCount.value * LANE_W))
const svgHeight = computed(() => (seqRange.value.max === 0 ? 120 : yOf(seqRange.value.max) + PAD_BOTTOM))

function laneX(index: number): number {
  return index * LANE_W + LANE_W / 2
}

// 分支泳道：主分支在 0 道，其余按返回顺序排开
const branchLanes = computed(() =>
  branches.value.map((b, i) => ({
    id: b.sessionId,
    label: branchLabel(b),
    index: i + 1,
    x: laneX(i + 1),
    color: PALETTE[i % PALETTE.length],
    commits: b.commits,
    forkCommit: b.forkCommit ?? null,
    merged: !!b.mergedIntoMain,
    current: b.sessionId === store.currentSessionId
  }))
)

function forkYOf(branch: { forkCommit?: string | null; commits: GraphCommit[] }): number {
  if (branch.forkCommit) {
    const found = allShas.value.get(branch.forkCommit)
    if (found) return yOf(found.seq)
  }
  if (branch.commits.length) return yOf(Math.min(...branch.commits.map((c) => c.seq)))
  return PAD_TOP
}

function tipY(branch: { commits: GraphCommit[] }): number {
  if (!branch.commits.length) return PAD_TOP
  return yOf(Math.max(...branch.commits.map((c) => c.seq)))
}

// 合并提交 → 分支 tip 的汇入连线
const mergeLinks = computed(() => {
  const links: { from: { x: number; y: number }; to: { x: number; y: number } }[] = []
  for (const mc of main.value?.commits ?? []) {
    if (!mc.merge || !mc.mergedSession) continue
    const idx = branches.value.findIndex((b) => b.sessionId === mc.mergedSession)
    if (idx < 0) continue
    const branch = branches.value[idx]
    const fromX = laneX(idx + 1)
    const fromY = branch.commits.length
      ? yOf(Math.max(...branch.commits.map((c) => c.seq)))
      : yOf(mc.seq)
    links.push({ from: { x: fromX, y: fromY }, to: { x: laneX(0), y: yOf(mc.seq) } })
  }
  return links
})

const selectedCommit = computed<GraphCommit | null>(() => allShas.value.get(selectedSha.value) ?? null)

// —— 加载
async function load(): Promise<void> {
  if (!props.open || !props.workspace) return
  loading.value = true
  error.value = ''
  try {
    const graph = await fetchSessionGraph(props.workspace)
    branches.value = graph?.branches ?? []
    main.value = graph?.main ?? null
    if (selectedSha.value && !allShas.value.has(selectedSha.value)) selectedSha.value = ''
    if (!selectedBranch.value) selectedBranch.value = branches.value[0]?.sessionId ?? ''
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '加载分支图失败。'
  } finally {
    loading.value = false
  }
}

function selectCommit(sha: string): void {
  selectedSha.value = sha
}

function selectBranch(sessionId: string): void {
  selectedBranch.value = sessionId
}

async function toggleDiff(): Promise<void> {
  const commit = selectedCommit.value
  if (!commit) return
  if (patches.value[commit.sha] !== undefined) return
  diffLoading.value = true
  try {
    patches.value[commit.sha] = await fetchRoundDiff(props.workspace, commit.sha)
  } catch {
    patches.value[commit.sha] = '（无法加载该轮差异）'
  } finally {
    diffLoading.value = false
  }
}

// —— 分支操作
async function mergeBranch(sessionId: string): Promise<void> {
  if (merging.value) return
  merging.value = true
  try {
    const result = await mergeSessionToMain(sessionId)
    if (result.ok === false || result.conflicts?.length) {
      const conflicts = result.conflicts?.length ? `（冲突文件：${result.conflicts.join('、')}）` : ''
      flash(`${result.error ?? '合并失败'}${conflicts}`)
    } else if (result.merged === 'already') {
      flash('该分支已包含在主分支中。')
    } else if (result.fastForward) {
      flash('已快进合并到主分支。')
    } else if (result.mergedSha) {
      flash('已合并到主分支。')
    }
    await load()
  } catch (cause) {
    flash(cause instanceof Error ? cause.message : '合并失败。')
  } finally {
    merging.value = false
  }
}

function openSession(sessionId: string): void {
  store.currentSessionId = sessionId
  emit('close')
}

function clearBranchChat(sessionId: string): void {
  const sess = store.sessions[sessionId]
  if (sess) clearChat(sess)
  flash('该分支聊天记录已清空（文件保留）。')
  void load()
}

function requestDeleteBranch(sessionId: string): void {
  if (confirmingDelete.value === sessionId) {
    confirmingDelete.value = ''
    if (deleteTimer) window.clearTimeout(deleteTimer)
    deleteSession(sessionId)
    void load()
    flash('已删除会话。')
    return
  }
  confirmingDelete.value = sessionId
  deleteTimer = window.setTimeout(() => {
    confirmingDelete.value = ''
  }, 3000)
}

function statusText(status: string): string {
  if (status.startsWith('R')) return `重命名 ${status.slice(1)}%`
  if (status.startsWith('C')) return `复制 ${status.slice(1)}%`
  return { A: '新增', M: '修改', D: '删除' }[status] ?? status
}

function filesTotal(files: GraphFile[]): { add: number; del: number } {
  let add = 0
  let del = 0
  for (const f of files) {
    add += f.add ?? 0
    del += f.del ?? 0
  }
  return { add, del }
}

const laneHeadStyle = { width: `${LANE_W}px`, minWidth: `${LANE_W}px` }

onMounted(load)
watch(() => props.open, load)
watch(
  () => store.currentSessionId,
  () => {
    if (props.open) void load()
  }
)
</script>

<template>
  <div v-if="open" class="graph-overlay" @click.self="emit('close')">
    <div class="graph-modal">
      <div class="graph-head">
        <div class="graph-title">
          <GitBranch :size="16" />
          版本与分支
          <span class="graph-sub">主分支 + 会话分支（每个会话是一条分支，每轮写入产生一个真实 git 提交）</span>
        </div>
        <button class="icon-btn" type="button" aria-label="关闭" @click="emit('close')"><X :size="16" /></button>
      </div>

      <div class="graph-body">
        <aside class="graph-lanes">
          <div class="lanes-head">分支</div>
          <div v-if="loading" class="lanes-empty">加载中…</div>
          <div v-else-if="error" class="lanes-empty warn">{{ error }}</div>
          <div v-else class="lanes-list">
            <div class="lane-row main-row">
              <span class="lane-name">
                <span class="mini-dot main-dot"></span>
                <strong>主分支</strong>
              </span>
              <span class="lane-meta">
                <span class="lane-count">{{ main?.commits.length ?? 0 }} 个提交</span>
                <span class="lane-hint">新分支从这里分叉</span>
              </span>
            </div>

            <div
              v-for="branch in branches"
              :key="branch.sessionId"
              class="lane-row"
              :class="{ active: selectedBranch === branch.sessionId }"
            >
              <div class="lane-name-row">
                <span
                  class="lane-name"
                  :class="{ current: branch.sessionId === store.currentSessionId }"
                  role="button"
                  :title="'打开该分支会话'"
                  @click="openSession(branch.sessionId)"
                >
                  <span class="mini-dot" :style="{ background: PALETTE[(branches.indexOf(branch)) % PALETTE.length] }"></span>
                  <strong>{{ branchLabel(branch) }}</strong>
                </span>
                <span class="lane-action">
                  <button
                    class="lane-btn merge-btn"
                    type="button"
                    :disabled="merging"
                    :title="'把这个分支的文件改动合并进主分支'"
                    @click.stop="mergeBranch(branch.sessionId)"
                  >
                    <GitMerge :size="12" />
                    合并
                  </button>
                  <button
                    class="lane-btn"
                    type="button"
                    title="打开该分支会话"
                    @click.stop="openSession(branch.sessionId)"
                  >
                    <MessageSquare :size="12" />
                  </button>
                  <button
                    class="lane-btn"
                    type="button"
                    title="清空该分支的聊天记录（文件保留）"
                    @click.stop="clearBranchChat(branch.sessionId)"
                  >
                    <Eraser :size="12" />
                  </button>
                  <button
                    class="lane-btn danger"
                    :class="{ confirm: confirmingDelete === branch.sessionId }"
                    type="button"
                    :title="confirmingDelete === branch.sessionId ? '再次点击确认删除' : '删除会话'"
                    @click.stop="requestDeleteBranch(branch.sessionId)"
                  >
                    <Trash2 :size="12" />
                  </button>
                </span>
              </div>
              <span class="lane-meta">
                <span class="lane-count">{{ branch.commits.length }} 个提交</span>
                <span v-if="branch.mergedIntoMain" class="lane-merged">已合并</span>
                <span v-if="branch.sessionId === store.currentSessionId" class="lane-mine">当前</span>
              </span>
            </div>

            <div v-if="!branches.length" class="lanes-empty">
              还没有分支记录。新建会话并让 agent 修改文件后，这里会按会话生成分支提交。
            </div>
          </div>
        </aside>

        <div class="graph-canvas">
          <div v-if="msg" class="graph-msg">{{ msg }}</div>
          <div class="lanes-head graph-main-head">
            分支图
            <span v-if="selectedCommit" class="fork-line">
              {{ selectedCommit.merge ? '合并提交' : `第 ${selectedCommit.round ?? '?'} 轮` }} · {{ selectedCommit.session }}
              <template v-if="selectedCommit.mergedSession">（来自 {{ sessionTitle(selectedCommit.mergedSession) }}）</template>
            </span>
          </div>

          <div class="lane-heads">
            <div
              class="lane-head main-head"
              :style="laneHeadStyle"
              :class="{ active: !selectedBranch }"
              @click="selectedBranch = ''"
            >
              <GitBranch :size="11" /> 主分支
            </div>
            <div
              v-for="lane in branchLanes"
              :key="lane.id"
              class="lane-head"
              :style="laneHeadStyle"
              :class="{ active: selectedBranch === lane.id }"
              @click="selectBranch(lane.id)"
            >
              <span class="head-dot" :style="{ background: lane.color }"></span>
              {{ lane.label }}
            </div>
          </div>

          <div class="lane-canvas">
            <svg :width="svgWidth" :height="svgHeight" :viewBox="`0 0 ${svgWidth} ${svgHeight}`">
              <!-- 主干 -->
              <line
                v-if="seqRange.max > 0"
                :x1="laneX(0)"
                :y1="yOf(seqRange.min)"
                :x2="laneX(0)"
                :y2="yOf(seqRange.max)"
                class="trunk-line"
              />
              <circle
                v-if="seqRange.max > 0"
                :cx="laneX(0)"
                :cy="yOf(seqRange.min)"
                r="3.5"
                fill="var(--accent)"
                stroke="var(--bg)"
                stroke-width="1.5"
              />

              <!-- 分支线：分叉肘线 + 泳道竖线 -->
              <template v-for="lane in branchLanes" :key="lane.id">
                <polyline
                  v-if="lane.commits.length"
                  class="edge-line"
                  :points="`${laneX(0)},${forkYOf(lane)} ${lane.x},${forkYOf(lane)} ${lane.x},${tipY(lane)}`"
                />
                <circle
                  v-else
                  :cx="lane.x"
                  :cy="forkYOf(lane)"
                  r="4.5"
                  fill="var(--bg)"
                  stroke="var(--border-strong)"
                  stroke-width="2"
                />
              </template>

              <!-- 合并线：分支 tip 斜向汇入主分支合并提交 -->
              <template v-for="link in mergeLinks" :key="`ml-${link.to.x}-${link.to.y}`">
                <line
                  class="merge-line"
                  :x1="link.from.x"
                  :y1="link.from.y"
                  :x2="link.to.x"
                  :y2="link.to.y"
                />
              </template>

              <!-- 提交节点 -->
              <template v-for="lc in main?.commits ?? []" :key="'md' + lc.sha">
                <g
                  class="graph-node"
                  :class="{ selected: selectedSha === lc.sha, dimmed: selectedBranch && selectedBranch !== 'main' }"
                  transform="translate(0,0)"
                  @click="selectCommit(lc.sha)"
                >
                  <rect
                    v-if="lc.merge"
                    :x="laneX(0) - 4.5"
                    :y="yOf(lc.seq) - 4.5"
                    width="9"
                    height="9"
                    rx="1"
                    class="merge-dot"
                  >
                    <title>{{ lc.session }} merge</title>
                  </rect>
                  <circle
                    v-else
                    :cx="laneX(0)"
                    :cy="yOf(lc.seq)"
                    r="5"
                    class="commit-dot"
                  >
                    <title>{{ lc.session }} round {{ lc.round }}</title>
                  </circle>
                </g>
              </template>

              <template v-for="lane in branchLanes" :key="'bn' + lane.id">
                <circle
                  v-for="c in lane.commits"
                  :key="'bd' + c.sha"
                  :cx="lane.x"
                  :cy="yOf(c.seq)"
                  r="5"
                  class="commit-dot branch-dot"
                  :class="{ selected: selectedSha === c.sha, dimmed: selectedBranch && selectedBranch !== lane.id }"
                  :fill="selectedSha === c.sha ? lane.color : lane.color"
                  @click="selectCommit(c.sha)"
                >
                  <title>{{ lane.label }} round {{ c.round }}</title>
                </circle>
              </template>
            </svg>
          </div>

          <div v-if="selectedCommit" class="commit-detail">
            <div class="detail-head">
              <button class="detail-toggle" type="button" @click="toggleDiff">
                <span class="detail-title">
                  <FileText :size="12" />
                  {{ selectedCommit.merge ? '合并提交' : `第 ${selectedCommit.round ?? '?'} 轮` }}
                  <template v-if="selectedCommit.mergedSession">· 来自「{{ sessionTitle(selectedCommit.mergedSession) }}」</template>
                  <template v-else>· {{ sessionTitle(selectedCommit.session) }}</template>
                </span>
                <span class="commit-files">
                  <span
                    v-for="file in selectedCommit.files"
                    :key="file.path + file.status"
                    class="file-chip"
                    :class="file.status"
                    :title="`${statusText(file.status)} · ${file.path}`"
                  >
                    <FileText :size="11" />
                    {{ file.path.split('/').pop() }}
                    <em v-if="file.add !== null">
                      <template v-if="file.status === 'D'">−{{ file.del ?? 0 }}</template>
                      <template v-else-if="file.status === 'A'">+{{ file.add ?? 0 }}</template>
                      <template v-else>+{{ file.add ?? 0 }} −{{ file.del ?? 0 }}</template>
                    </em>
                  </span>
                  <span v-if="!selectedCommit.files.length" class="no-files">无文件改动</span>
                  <span v-else class="no-files">
                    合计 +{{ filesTotal(selectedCommit.files).add }} −{{ filesTotal(selectedCommit.files).del }}
                  </span>
                </span>
                <span class="detail-chevron">查看差异 ▾</span>
              </button>
              <div v-if="patches[selectedCommit.sha]" class="commit-diff">
                <div v-if="diffLoading" class="lanes-empty">加载差异…</div>
                <pre v-else>{{ patches[selectedCommit.sha] || '（无内容差异）' }}</pre>
              </div>
            </div>
          </div>

          <div v-if="!loading && !error && !allShas.size" class="lanes-empty">
            还没有提交记录。让 agent 修改过文件后，分支与提交会显示在这里。
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.graph-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(10, 14, 12, 0.45);
}

.graph-modal {
  display: flex;
  flex-direction: column;
  width: min(1100px, calc(100vw - 60px));
  height: min(720px, calc(100vh - 80px));
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-m);
  background: var(--bg);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.25);
  overflow: hidden;
}

.graph-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-soft);
}

.graph-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 700;
}

.graph-sub {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 400;
}

.graph-body {
  display: flex;
  min-height: 0;
  flex: 1;
}

.graph-lanes {
  width: 300px;
  flex: none;
  min-height: 0;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
}

.graph-canvas {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  position: relative;
}

.graph-msg {
  position: absolute;
  top: 8px;
  right: 12px;
  z-index: 5;
  max-width: 70%;
  padding: 6px 10px;
  border-radius: var(--radius-s);
  background: var(--teal-soft);
  color: var(--teal);
  font-size: 12px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.15);
}

.lanes-head,
.graph-main-head {
  flex: none;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 700;
}

.graph-main-head {
  position: relative;
}

.fork-line {
  margin-left: 8px;
  color: var(--teal);
  font-weight: 400;
}

.lanes-list {
  overflow-y: auto;
  min-height: 0;
  flex: 1;
}

.lanes-empty {
  padding: 16px 14px;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.6;
}

.lanes-empty.warn {
  color: var(--danger);
}

.lane-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  padding: 9px 12px;
  border-bottom: 1px solid var(--border);
  color: var(--text-secondary);
}

.lane-row:hover {
  background: var(--bg-soft);
}

.lane-row.active {
  background: var(--accent-soft);
}

.lane-row.main-row {
  background: rgba(255, 106, 43, 0.05);
  color: var(--accent);
}

.lane-name-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.lane-name {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  cursor: pointer;
  padding: 2px 0;
}

.lane-name.current strong {
  color: var(--accent);
}

.lane-name strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
}

.mini-dot {
  width: 10px;
  height: 10px;
  flex: none;
  border-radius: 50%;
}

.main-dot {
  background: var(--accent);
}

.lane-action {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: none;
}

.lane-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 7px;
  border-radius: var(--radius-s);
  color: var(--text-muted);
  font-size: 11px;
}

.lane-btn:hover {
  background: var(--bg-raised);
  color: var(--text);
}

.lane-btn.merge-btn {
  color: var(--teal);
  font-weight: 600;
}

.lane-btn.danger.confirm {
  background: rgba(217, 67, 67, 0.14);
  color: var(--danger);
}

.lane-btn.danger.confirm::after {
  content: '';
  white-space: nowrap;
}

.lane-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-left: 17px;
  font-size: 11px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.lane-count {
  margin-right: auto;
}

.lane-merged {
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--teal-soft);
  color: var(--teal);
  font-family: var(--font-sans);
}

.lane-mine {
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-family: var(--font-sans);
}

.lane-hint {
  color: var(--text-muted);
  font-family: var(--font-sans);
  opacity: 0.75;
}

.lane-heads {
  display: flex;
  flex: none;
  overflow-x: auto;
  border-bottom: 1px solid var(--border);
  background: var(--bg-soft);
}

.lane-head {
  display: flex;
  align-items: center;
  gap: 5px;
  width: var(--lane, 132px);
  min-width: var(--lane, 132px);
  padding: 8px 10px;
  font-size: 11px;
  color: var(--text-muted);
  cursor: pointer;
  border-right: 1px solid var(--border);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lane-head.active {
  background: var(--bg-raised);
  color: var(--text);
  font-weight: 600;
}

.lane-head.main-head {
  color: var(--accent);
}

.head-dot {
  width: 8px;
  height: 8px;
  flex: none;
  border-radius: 50%;
}

.lane-canvas {
  min-height: 0;
  flex: 1;
  overflow: auto;
}

.lane-canvas svg {
  display: block;
}

.trunk-line {
  stroke: var(--accent);
  stroke-width: 3;
  opacity: 0.85;
}

.edge-line {
  fill: none;
  stroke: var(--border-strong);
  stroke-width: 2;
}

.merge-line {
  fill: none;
  stroke: var(--teal);
  stroke-width: 2;
  stroke-dasharray: 4 3;
  opacity: 0.8;
}

.graph-node {
  cursor: pointer;
}

.commit-dot {
  stroke: var(--bg);
  stroke-width: 2;
  opacity: 0.95;
}

.commit-dot.selected {
  stroke-width: 3;
  stroke: var(--bg);
  filter: drop-shadow(0 0 4px rgba(15, 133, 118, 0.6));
}

.graph-node.dimmed,
.commit-dot.dimmed {
  opacity: 0.25;
}

.merge-dot {
  fill: var(--accent);
  stroke: var(--bg);
  stroke-width: 2;
  opacity: 0.95;
}

.branch-dot {
  cursor: pointer;
}

.commit-detail {
  flex: none;
  max-height: 220px;
  overflow: auto;
  border-top: 1px solid var(--border);
  background: var(--bg-soft);
}

.detail-head {
  padding: 8px 12px;
}

.detail-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
  color: var(--text-secondary);
}

.detail-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: none;
  font-size: 12px;
  font-weight: 700;
  color: var(--text);
}

.commit-files {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  min-width: 0;
  flex: 1;
}

.file-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--bg-raised);
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-secondary);
}

.file-chip.A {
  background: var(--teal-soft);
  color: var(--teal);
}

.file-chip.D {
  background: rgba(217, 67, 67, 0.12);
  color: var(--danger);
}

.file-chip em {
  font-style: normal;
  opacity: 0.8;
}

.no-files {
  color: var(--text-muted);
  font-size: 11px;
}

.detail-chevron {
  flex: none;
  color: var(--text-muted);
  font-size: 11px;
}

.commit-diff {
  margin-top: 8px;
  border-top: 1px dashed var(--border);
}

.commit-diff pre {
  max-height: 150px;
  margin: 0;
  padding: 10px 4px;
  overflow: auto;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.6;
  white-space: pre;
  color: var(--text-secondary);
}
</style>