<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { KeyRound, Plus, Save, Trash2, Wifi, X, Zap } from 'lucide-vue-next'
import { store } from '../store'
import type { ProviderId, SavedKey } from '../types'

const form = reactive({
  label: '',
  provider: 'openai-compatible' as ProviderId,
  baseUrl: '',
  apiKey: '',
  model: ''
})
const editingId = ref<string | null>(null)
const notice = ref('')

const providerNames: Record<ProviderId, string> = {
  anthropic: 'Anthropic Claude',
  'openai-compatible': 'OpenAI 兼容',
  ollama: 'Ollama 本地'
}

const providerDefaults: Record<ProviderId, string> = {
  anthropic: 'https://api.anthropic.com',
  'openai-compatible': 'https://api.deepseek.com/v1',
  ollama: 'http://localhost:11434/v1'
}

const saved = computed(() => store.savedKeys)

function maskKey(key: string): string {
  if (!key) return ''
  const head = key.slice(0, 5)
  const tail = key.slice(-4)
  return `${head}••••••••••${tail}`
}

function selectPreset(provider: ProviderId): void {
  form.provider = provider
  if (!form.baseUrl) form.baseUrl = providerDefaults[provider]
}

function editKey(key: SavedKey): void {
  editingId.value = key.id
  form.label = key.label
  form.provider = key.provider
  form.baseUrl = key.baseUrl
  form.model = key.model
  form.apiKey = ''
  notice.value = ''
}

function startNew(): void {
  editingId.value = null
  form.label = ''
  form.baseUrl = ''
  form.apiKey = ''
  form.model = ''
  notice.value = ''
}

function saveKey(): void {
  if (!form.label.trim() || !form.apiKey.trim() || !form.model.trim()) {
    notice.value = '请至少填写名称、API Key 和模型名。'
    return
  }
  const entry: SavedKey = {
    id: editingId.value ?? `k-${Date.now()}`,
    provider: form.provider,
    label: form.label.trim(),
    baseUrl: form.baseUrl.trim() || providerDefaults[form.provider],
    model: form.model.trim(),
    maskedKey: maskKey(form.apiKey.trim())
  }
  const index = store.savedKeys.findIndex((item) => item.id === entry.id)
  if (index >= 0) store.savedKeys[index] = entry
  else store.savedKeys.push(entry)
  notice.value = '已保存到本机演示存储。'
  startNew()
}

function removeKey(id: string): void {
  store.savedKeys = store.savedKeys.filter((item) => item.id !== id)
  if (editingId.value === id) startNew()
}
</script>

<template>
  <div class="settings-overlay" @click.self="store.showSettings = false">
    <div class="settings-dialog" role="dialog" aria-label="模型设置">
      <header class="settings-head">
        <div>
          <h2>模型与密钥</h2>
          <p>为会话选择可用的模型接入；密钥只在本机演示环境中做脱敏存储。</p>
        </div>
        <button class="icon-btn" type="button" aria-label="关闭设置" @click="store.showSettings = false">
          <X :size="18" />
        </button>
      </header>

      <div class="settings-body">
        <section class="saved-section">
          <div class="section-head">
            <span>已保存的密钥</span>
            <button class="btn-ghost small" type="button" @click="startNew">
              <Plus :size="14" />
              新增
            </button>
          </div>

          <div v-if="saved.length" class="key-list">
            <div v-for="key in saved" :key="key.id" class="key-row" :class="{ editing: key.id === editingId }">
              <span class="key-icon"><KeyRound :size="16" /></span>
              <div class="key-copy">
                <strong>{{ key.label }}</strong>
                <code>{{ key.model }}</code>
                <small>{{ key.maskedKey }}</small>
              </div>
              <div class="key-actions">
                <button class="icon-btn" type="button" aria-label="编辑" @click="editKey(key)"><Wifi :size="15" /></button>
                <button class="icon-btn danger" type="button" aria-label="删除" @click="removeKey(key.id)"><Trash2 :size="15" /></button>
              </div>
            </div>
          </div>
          <div v-else class="empty-keys">还没有保存的密钥，从右侧新增一个接入。</div>
        </section>

        <section class="form-section">
          <div class="section-head">
            <span>{{ editingId ? '编辑接入' : '新增接入' }}</span>
            <Zap :size="14" class="head-icon" />
          </div>

          <form class="settings-form" @submit.prevent="saveKey">
            <label class="form-field">
              <span>名称</span>
              <input v-model="form.label" class="field" type="text" placeholder="例如：公司 DeepSeek 账号" />
            </label>

            <label class="form-field">
              <span>提供方</span>
              <select v-model="form.provider" class="field" @change="selectPreset(form.provider)">
                <option v-for="(label, id) in providerNames" :key="id" :value="id">{{ label }}</option>
              </select>
            </label>

            <label class="form-field">
              <span>接口地址</span>
              <input v-model="form.baseUrl" class="field mono" type="text" :placeholder="providerDefaults[form.provider]" />
            </label>

            <label class="form-field">
              <span>API Key</span>
              <input v-model="form.apiKey" class="field mono" type="password" placeholder="sk-…" autocomplete="off" />
            </label>

            <label class="form-field">
              <span>模型名</span>
              <input v-model="form.model" class="field mono" type="text" placeholder="deepseek-chat" />
            </label>

            <p v-if="notice" class="form-notice">{{ notice }}</p>

            <div class="form-actions">
              <button class="btn-primary" type="submit">
                <Save :size="15" />
                保存接入
              </button>
              <button v-if="editingId" class="btn-ghost" type="button" @click="startNew">取消编辑</button>
            </div>
          </form>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(28, 37, 34, 0.32);
  backdrop-filter: blur(4px);
}

.settings-dialog {
  display: flex;
  flex-direction: column;
  width: min(880px, 100%);
  max-height: calc(100vh - 48px);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-m);
  background: var(--bg-soft);
  box-shadow: var(--shadow-pop);
}

.settings-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px;
  border-bottom: 1px solid var(--border);
}

.settings-head h2 {
  margin: 0 0 4px;
  font-size: 18px;
}

.settings-head p {
  color: var(--text-muted);
  font-size: 12px;
}

.settings-body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  overflow: hidden;
  background: var(--border);
}

.saved-section,
.form-section {
  padding: 18px 20px 22px;
  background: var(--bg);
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 14px;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 600;
}

.btn-ghost.small {
  min-height: 30px;
  padding: 4px 10px;
  font-size: 12px;
}

.head-icon {
  color: var(--accent);
}

.key-list {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.key-row {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  padding: 12px 4px;
  border: 0;
  border-bottom: 1px solid var(--border);
  border-radius: 0;
  background: transparent;
}

.key-row:last-child {
  border-bottom: 0;
}

.key-row.editing {
  border-left: 2px solid var(--accent);
  background: var(--accent-soft);
}

.key-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  flex: none;
  border-radius: var(--radius-s);
  background: var(--accent-soft);
  color: var(--accent);
}

.key-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.key-copy strong {
  font-size: 13px;
}

.key-copy code,
.key-copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-secondary);
}

.key-copy small {
  color: var(--text-muted);
}

.key-actions {
  display: flex;
  gap: 2px;
  flex: none;
}

.icon-btn.danger {
  color: var(--text-muted);
}

.icon-btn.danger:hover {
  background: rgba(217, 67, 67, 0.1);
  color: var(--danger);
}

.empty-keys {
  padding: 24px 12px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-s);
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
}

.settings-form {
  display: flex;
  flex-direction: column;
  gap: 13px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-field span {
  color: var(--text-secondary);
  font-size: 12px;
}

.field.mono {
  font-family: var(--font-mono);
  font-size: 12px;
}

.form-notice {
  color: var(--teal);
  font-size: 12px;
}

.form-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

@media (max-width: 780px) {
  .settings-overlay {
    padding: 0;
  }

  .settings-dialog {
    height: 100%;
    max-height: 100%;
    border: 0;
    border-radius: 0;
  }

  .settings-body {
    grid-template-columns: 1fr;
    overflow-y: auto;
  }
}
</style>
