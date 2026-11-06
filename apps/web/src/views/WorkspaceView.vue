<script setup lang="ts">
import { computed } from 'vue'
import { FolderPlus, MessagesSquare } from 'lucide-vue-next'
import { store } from '../store'
import TopBar from '../components/TopBar.vue'
import Sidebar from '../components/Sidebar.vue'
import ConversationPanel from '../components/ConversationPanel.vue'
import StatusDrawer from '../components/StatusDrawer.vue'
import ModelSettings from '../components/ModelSettings.vue'
import ProjectForm from '../components/ProjectForm.vue'
import VirtualPet from '../components/VirtualPet.vue'

const hasSession = computed(() => Boolean(store.currentSessionId && store.sessions[store.currentSessionId]))
</script>

<template>
  <div class="workspace">
    <TopBar />
    <div class="workspace-body">
      <div v-if="store.mobileSidebarOpen" class="scrim sidebar-scrim" @click="store.mobileSidebarOpen = false"></div>
      <Sidebar />
      <ConversationPanel v-if="hasSession" />
      <div v-else class="workspace-empty">
        <span class="empty-mark"><MessagesSquare :size="22" /></span>
        <h2>{{ store.projects.length ? '这个项目还没有会话' : '还没有项目' }}</h2>
        <p v-if="store.projects.length">在左侧新建一个会话，或先选择一个项目。</p>
        <p v-else>先创建一个项目，再把服务器目录关联进来。</p>
        <button v-if="!store.projects.length" class="btn-primary" type="button" @click="store.showProjectForm = true">
          <FolderPlus :size="16" />
          新建项目
        </button>
      </div>
      <div v-if="store.mobileDrawerOpen" class="scrim drawer-scrim" @click="store.mobileDrawerOpen = false"></div>
      <StatusDrawer />
    </div>
    <ModelSettings v-if="store.showSettings" />
    <ProjectForm v-if="store.showProjectForm" />
    <VirtualPet />
  </div>
</template>

<style scoped>
.workspace {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.workspace-body {
  display: flex;
  min-height: 0;
  flex: 1;
}

.workspace-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-width: 0;
  padding: 30px;
  text-align: center;
  background: var(--bg);
}

.empty-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  margin-bottom: 14px;
  border-radius: var(--radius-m);
  background: var(--accent-soft);
  color: var(--accent);
}

.workspace-empty h2 {
  margin: 0 0 6px;
  font-size: 18px;
}

.workspace-empty p {
  max-width: 360px;
  margin: 0 0 18px;
  color: var(--text-secondary);
  font-size: 13px;
}

.scrim {
  display: none;
}

@media (max-width: 760px) {
  .sidebar {
    position: fixed;
    z-index: 32;
    inset: 52px auto auto 0;
    bottom: 0;
    box-shadow: var(--shadow-pop);
    transform: translateX(-100%);
    transition: transform 0.22s ease;
  }

  .drawer {
    transform: translateX(100%);
    transition: transform 0.22s ease;
  }

  .workspace-body:has(.scrim.sidebar-scrim) .sidebar,
  .workspace-body:has(.scrim.drawer-scrim) .drawer {
    transform: none;
  }

  .scrim {
    position: fixed;
    inset: 52px 0 0;
    z-index: 31;
    display: block;
    background: rgba(28, 37, 34, 0.28);
  }
}
</style>