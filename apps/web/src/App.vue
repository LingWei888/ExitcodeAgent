<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import { store, applyVaultData, lockAccount } from './store'
import { restoreVaultSession } from './services/secureStore'
import LoginView from './views/LoginView.vue'
import WorkspaceView from './views/WorkspaceView.vue'

// 同一标签页刷新时静默恢复登录态（sessionStorage 中的会话令牌），失败则回到登录页
onMounted(async () => {
  if (store.unlocked) return
  const data = await restoreVaultSession()
  if (data) applyVaultData(data)
})

// 会话过期（服务端空闲超时等）→ 自动回到登录页
function onSessionExpired(): void {
  if (store.unlocked) lockAccount()
}

onMounted(() => window.addEventListener('exitcode:session-expired', onSessionExpired))
onBeforeUnmount(() => window.removeEventListener('exitcode:session-expired', onSessionExpired))
</script>

<template>
  <LoginView v-if="!store.unlocked" />
  <WorkspaceView v-else />
</template>
