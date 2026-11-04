<script setup lang="ts">
import { store } from './store'
import LoginView from './views/LoginView.vue'
import WorkspaceView from './views/WorkspaceView.vue'
</script>

<template>
  <LoginView v-if="!store.unlocked" />
  <WorkspaceView v-else />
</template>
