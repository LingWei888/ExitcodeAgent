<script setup lang="ts">
import { store } from '../store'
import TopBar from '../components/TopBar.vue'
import Sidebar from '../components/Sidebar.vue'
import ConversationPanel from '../components/ConversationPanel.vue'
import StatusDrawer from '../components/StatusDrawer.vue'
import ModelSettings from '../components/ModelSettings.vue'
</script>

<template>
  <div class="workspace">
    <TopBar />
    <div class="workspace-body">
      <div v-if="store.mobileSidebarOpen" class="scrim sidebar-scrim" @click="store.mobileSidebarOpen = false"></div>
      <Sidebar />
      <ConversationPanel />
      <div v-if="store.mobileDrawerOpen" class="scrim drawer-scrim" @click="store.mobileDrawerOpen = false"></div>
      <StatusDrawer />
    </div>
    <ModelSettings v-if="store.showSettings" />
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
