<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronDown, ListChecks } from 'lucide-vue-next'
import type { ToolCall } from '../types'
import ToolCallItem from './ToolCallItem.vue'

const props = defineProps<{ tools: ToolCall[] }>()
const open = ref(false)

const counts = computed(() => {
  const map: Record<string, number> = {}
  for (const tool of props.tools) {
    map[tool.title] = (map[tool.title] ?? 0) + 1
  }
  return Object.entries(map).map(([title, n]) => ({ title, n }))
})
</script>

<template>
  <div class="tool-group" :class="{ open }">
    <button class="group-row" type="button" :title="'展开查看全部 ' + tools.length + ' 个工具' " @click="open = !open">
      <span class="group-icon"><ListChecks :size="14" /></span>
      <span class="group-copy">
        <strong>已连续完成 {{ tools.length }} 个工具调用</strong>
        <span class="group-counts">
          <span v-for="c in counts" :key="c.title" class="count-chip">{{ c.title }} ×{{ c.n }}</span>
        </span>
      </span>
      <ChevronDown class="group-chevron" :class="{ open }" :size="14" />
    </button>
    <div v-if="open" class="group-items">
      <ToolCallItem v-for="tool in tools" :key="tool.id" :tool="tool" />
    </div>
  </div>
</template>

<style scoped>
.tool-group {
  margin: 4px 0;
  border: 1px solid var(--border);
  border-left: 2px solid var(--teal);
  border-radius: 8px;
  background: rgba(28, 37, 34, 0.02);
  overflow: hidden;
}

.group-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  text-align: left;
  color: var(--text-secondary);
}

.group-row:hover {
  background: var(--bg-soft);
}

.group-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  flex: none;
  border-radius: var(--radius-s);
  background: var(--teal-soft);
  color: var(--teal);
}

.group-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.group-copy strong {
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
}

.group-counts {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 3px;
}

.count-chip {
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--bg-raised);
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
}

.group-chevron {
  flex: none;
  color: var(--text-muted);
  transition: transform 0.16s ease;
}

.group-chevron.open {
  transform: rotate(180deg);
}

.group-items {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 8px 8px;
}
</style>