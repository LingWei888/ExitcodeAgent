<script setup lang="ts">
import { ref } from 'vue'
import { Check, FolderPlus, FolderOpen, X } from 'lucide-vue-next'
import { createProject, store } from '../store'
import ServerDirectoryPicker from './ServerDirectoryPicker.vue'

const name = ref('')
const description = ref('')
const directoryPath = ref('')
const pickerOpen = ref(false)
const error = ref('')
const busy = ref(false)

function chooseDirectory(): void {
  error.value = ''
  pickerOpen.value = true
}

function handleSelect(path: string): void {
  directoryPath.value = path
  pickerOpen.value = false
}

async function create(): Promise<void> {
  if (!name.value.trim()) {
    error.value = '请填写项目名称。'
    return
  }
  busy.value = true
  createProject(name.value, description.value, directoryPath.value || undefined)
  store.showProjectForm = false
}
</script>

<template>
  <div class="overlay" @click.self="store.showProjectForm = false">
    <div class="dialog" role="dialog" aria-label="新建项目">
      <header class="dialog-head">
        <div>
          <h2>新建项目</h2>
          <p>项目数据记录在服务器，可选择服务器目录作为工作区。</p>
        </div>
        <button class="icon-btn" type="button" aria-label="关闭" @click="store.showProjectForm = false">
          <X :size="18" />
        </button>
      </header>

      <form class="dialog-form" @submit.prevent="create">
        <label class="form-field">
          <span>项目名称</span>
          <input v-model="name" class="field" type="text" placeholder="例如：文档站点" />
        </label>

        <label class="form-field">
          <span>描述</span>
          <input v-model="description" class="field" type="text" placeholder="可选" />
        </label>

        <div class="form-field">
          <span>服务器目录</span>
          <button class="dir-picker" :class="{ chosen: directoryPath }" type="button" @click="chooseDirectory">
            <FolderOpen v-if="!directoryPath" :size="17" />
            <Check v-else :size="17" />
            <span>{{ directoryPath || '选择服务器目录' }}</span>
          </button>
        </div>

        <p v-if="error" class="form-error">{{ error }}</p>

        <div class="dialog-actions">
          <button class="btn-primary" type="submit" :disabled="busy">
            <FolderPlus :size="15" />
            {{ busy ? '创建中' : '创建项目' }}
          </button>
        </div>
      </form>
    </div>

    <ServerDirectoryPicker
      v-if="pickerOpen"
      :current-path="directoryPath || undefined"
      @select="handleSelect"
      @close="pickerOpen = false"
    />
  </div>
</template>

<style scoped>
.overlay {
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

.dialog {
  width: min(440px, 100%);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-m);
  background: var(--bg-soft);
  box-shadow: var(--shadow-pop);
}

.dialog-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 20px 14px;
  border-bottom: 1px solid var(--border);
}

.dialog-head h2 {
  margin: 0 0 4px;
  font-size: 17px;
}

.dialog-head p {
  color: var(--text-muted);
  font-size: 12px;
}

.dialog-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px 20px 20px;
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

.dir-picker {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 40px;
  padding: 8px 12px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-s);
  background: var(--bg);
  color: var(--text-secondary);
  font-size: 13px;
  text-align: left;
}

.dir-picker:hover {
  border-color: var(--accent);
  color: var(--text);
  background: var(--accent-soft);
}

.dir-picker.chosen {
  border-style: solid;
  border-color: rgba(15, 133, 118, 0.35);
  color: var(--teal);
  background: var(--teal-soft);
}

.form-error {
  color: var(--danger);
  font-size: 12px;
  margin: 0;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 4px;
}
</style>
