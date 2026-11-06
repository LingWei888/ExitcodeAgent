<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { Bot, ChevronDown, Lock, PanelLeftOpen, PanelRightOpen, Settings } from 'lucide-vue-next'
import { currentConnection, lockAccount, store } from '../store'

const modelMenuOpen = ref(false)
const userMenuOpen = ref(false)

function closeMenus(event: MouseEvent): void {
  if ((event.target as HTMLElement).closest('.menu-anchor')) return
  modelMenuOpen.value = false
  userMenuOpen.value = false
}

document.addEventListener('click', closeMenus)
onBeforeUnmount(() => document.removeEventListener('click', closeMenus))

const modelOptions = computed(() =>
  store.savedKeys.map((key) => ({ id: key.id, provider: key.provider, label: key.label, model: key.model }))
)
const activeConnection = computed(() => currentConnection())

function selectModel(id: string): void {
  store.currentModelId = id
  modelMenuOpen.value = false
}
</script>

<template>
  <header class="topbar">
    <div class="left">
      <button class="icon-btn mobile-toggle" type="button" aria-label="打开侧栏" @click="store.mobileSidebarOpen = !store.mobileSidebarOpen">
        <PanelLeftOpen :size="18" />
      </button>
      <span class="logo-mark"><img src="/logo.ico" alt="ExitcodeAgent" /></span>
      <span class="brand">ExitcodeAgent</span>
      <span class="env-chip"><span class="dot" :class="{ pulse: Boolean(activeConnection), warn: !activeConnection }"></span>服务器加密存储</span>
    </div>

    <div class="right">
      <div class="menu-anchor model-menu">
        <button class="model-trigger" type="button" @click="modelMenuOpen = !modelMenuOpen">
          <Bot :size="15" />
          <span class="model-label">{{ activeConnection?.label ?? '未配置模型' }}</span>
          <ChevronDown :size="14" />
        </button>
        <div v-if="modelMenuOpen" class="menu-pop model-pop">
          <div class="menu-title">会话模型</div>
          <template v-if="modelOptions.length">
            <button
              v-for="model in modelOptions"
              :key="model.id"
              class="menu-item"
              :class="{ active: model.id === store.currentModelId }"
              type="button"
              @click="selectModel(model.id)"
            >
              <span class="provider-badge" :class="model.provider">{{ model.provider }}</span>
              <span class="menu-item-copy">
                <strong>{{ model.label }}</strong>
                <small>{{ model.model }}</small>
              </span>
            </button>
          </template>
          <div v-else class="empty-models">
            <span>还没有模型接入</span>
            <button type="button" @click="store.showSettings = true">添加 API Key</button>
          </div>
        </div>
      </div>

      <button class="icon-btn" type="button" aria-label="模型设置" title="模型设置" @click="store.showSettings = true">
        <Settings :size="17" />
      </button>

      <span class="status-divider"></span>

      <div class="menu-anchor user-menu">
        <button class="user-trigger" type="button" @click="userMenuOpen = !userMenuOpen">
          <span class="avatar">{{ store.user?.name?.slice(0, 1) ?? '您' }}</span>
          <span class="user-name">{{ store.user?.name ?? '服务器用户' }}</span>
          <ChevronDown :size="14" />
        </button>
        <div v-if="userMenuOpen" class="menu-pop">
          <div class="menu-user">
            <strong>{{ store.user?.name }}</strong>
            <small>{{ store.user?.email }}</small>
          </div>
          <button class="menu-item" type="button" @click="lockAccount">
            <Lock :size="15" />
            <span>锁定账号</span>
          </button>
        </div>
      </div>

      <button class="icon-btn mobile-toggle" type="button" aria-label="打开状态面板" @click="store.mobileDrawerOpen = !store.mobileDrawerOpen">
        <PanelRightOpen :size="18" />
      </button>
    </div>
  </header>
</template>

<style scoped>
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 52px;
  flex: none;
  padding: 0 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-soft);
}

.left,
.right {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.logo-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-s);
}

.logo-mark img {
  width: 30px;
  height: 30px;
  border-radius: 4px;
}

.brand {
  font-weight: 700;
  white-space: nowrap;
}

.env-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text-secondary);
  font-size: 12px;
  white-space: nowrap;
}

.status-divider {
  width: 1px;
  height: 24px;
  background: var(--border);
}

.menu-anchor {
  position: relative;
}

.model-trigger,
.user-trigger {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-s);
  background: rgba(28, 37, 34, 0.03);
  color: var(--text-secondary);
  font-size: 13px;
}

.model-trigger:hover,
.user-trigger:hover {
  color: var(--text);
  border-color: var(--border-strong);
}

.model-label {
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--teal-soft);
  color: var(--teal);
  font-size: 12px;
  font-weight: 700;
}


.empty-models {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  color: var(--text-muted);
  font-size: 12px;
}

.empty-models button {
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-s);
  background: var(--bg-soft);
  color: var(--text);
  font-size: 12px;
  text-align: left;
}

.empty-models button:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.user-name {
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.menu-pop {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 40;
  width: 232px;
  padding: 6px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-m);
  background: var(--bg-raised);
  box-shadow: var(--shadow-pop);
}

.model-pop {
  width: 280px;
}

.menu-title {
  padding: 8px 10px 6px;
  color: var(--text-muted);
  font-size: 12px;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border-radius: var(--radius-s);
  text-align: left;
  color: var(--text-secondary);
}

.menu-item:hover,
.menu-item.active {
  background: rgba(28, 37, 34, 0.07);
  color: var(--text);
}

.menu-item-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.menu-item-copy strong {
  font-size: 13px;
  font-weight: 600;
}

.menu-item-copy small {
  color: var(--text-muted);
  font-size: 11px;
}

.provider-badge {
  flex: none;
  min-width: 92px;
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(28, 37, 34, 0.08);
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  text-align: center;
}

.provider-badge.anthropic {
  background: rgba(255, 106, 43, 0.14);
  color: #bd4713;
}

.provider-badge.openai-compatible {
  background: var(--teal-soft);
  color: var(--teal);
}

.provider-badge.ollama {
  background: rgba(169, 116, 16, 0.16);
  color: var(--warning);
}

.menu-user {
  display: flex;
  flex-direction: column;
  padding: 8px 10px 10px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 4px;
}

.menu-user strong {
  font-size: 13px;
}

.menu-user small {
  color: var(--text-muted);
  font-size: 11px;
}

.mobile-toggle {
  display: none;
}

@media (max-width: 760px) {
  .mobile-toggle {
    display: inline-flex;
  }

  .user-name,
  .env-chip,
  .brand {
    display: none;
  }
}
</style>
