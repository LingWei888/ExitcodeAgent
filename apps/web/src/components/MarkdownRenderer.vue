<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

const props = defineProps<{
  text: string
  streaming?: boolean
}>()

const container = ref<HTMLElement | null>(null)
const html = ref('')
let lastSource: string | null = null
let pendingFrame = 0

function escapeHtml(source: string): string {
  return String(source)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

marked.use({ gfm: true, breaks: true })

function sanitize(raw: string): string {
  return DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form', 'input', 'textarea', 'select', 'iframe', 'script', 'object', 'embed'],
    FORBID_ATTR: ['style', 'srcdoc', 'content']
  })
}

function enhance(): void {
  const el = container.value
  if (!el) return
  for (const anchor of el.querySelectorAll('a[href]')) {
    const a = anchor as HTMLAnchorElement
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
  }
  for (const pre of el.querySelectorAll('pre')) {
    if (pre.dataset.enhanced === '1') continue
    pre.dataset.enhanced = '1'
    const code = pre.querySelector('code')
    const langMatch = code?.className.match(/language-([\w-]+)/)
    const lang = langMatch ? langMatch[1] : ''
    pre.dataset.lang = lang || 'code'
    const header = document.createElement('div')
    header.className = 'code-head'
    const label = document.createElement('span')
    label.className = 'code-lang'
    label.textContent = lang || '代码'
    const copy = document.createElement('button')
    copy.type = 'button'
    copy.className = 'code-copy'
    copy.dataset.copyCode = '1'
    copy.textContent = '复制'
    header.append(label, copy)
    pre.insertBefore(header, pre.firstChild)
  }
}

function render(): void {
  const source = props.text ?? ''
  if (source === lastSource) return
  lastSource = source
  if (!source) {
    html.value = ''
    return
  }
  try {
    const raw = marked.parse(source) as string
    html.value = sanitize(raw)
  } catch {
    html.value = escapeHtml(source).replace(/\n/g, '<br>')
  }
  void nextTick(enhance)
}

watch(
  () => props.text,
  () => {
    if (props.streaming) {
      if (pendingFrame) return
      pendingFrame = requestAnimationFrame(() => {
        pendingFrame = 0
        render()
      })
    } else {
      if (pendingFrame) cancelAnimationFrame(pendingFrame)
      pendingFrame = 0
      render()
    }
  },
  { immediate: true }
)

function onContainerClick(event: MouseEvent): void {
  const target = event.target as HTMLElement
  if (target.dataset?.copyCode !== '1') return
  const pre = target.closest('pre')
  const code = pre?.querySelector('code')
  if (!code) return
  void navigator.clipboard.writeText(code.textContent ?? '').then(() => {
    const original = target.textContent
    target.textContent = '已复制'
    target.classList.add('copied')
    setTimeout(() => {
      target.textContent = original
      target.classList.remove('copied')
    }, 1200)
  })
}

onBeforeUnmount(() => {
  if (pendingFrame) cancelAnimationFrame(pendingFrame)
})
</script>

<template>
  <div ref="container" class="markdown-body" v-html="html" @click="onContainerClick"></div>
</template>

<style>
.markdown-body {
  font-size: 14px;
  line-height: 1.75;
  color: var(--text);
  word-break: break-word;
}

.markdown-body > *:first-child {
  margin-top: 0;
}

.markdown-body > *:last-child {
  margin-bottom: 0;
}

.markdown-body p {
  margin: 0.6em 0;
}

.markdown-body h1,
.markdown-body h2,
.markdown-body h3,
.markdown-body h4,
.markdown-body h5,
.markdown-body h6 {
  margin: 1.1em 0 0.5em;
  font-weight: 700;
  line-height: 1.4;
  color: var(--text);
}

.markdown-body h1 {
  font-size: 1.45em;
  padding-bottom: 0.3em;
  border-bottom: 1px solid var(--border);
}

.markdown-body h2 {
  font-size: 1.28em;
  padding-bottom: 0.25em;
  border-bottom: 1px solid var(--border);
}

.markdown-body h3 {
  font-size: 1.13em;
}

.markdown-body h4,
.markdown-body h5,
.markdown-body h6 {
  font-size: 1em;
}

.markdown-body ul,
.markdown-body ol {
  margin: 0.6em 0;
  padding-left: 1.5em;
}

.markdown-body li {
  margin: 0.25em 0;
}

.markdown-body li > input[type='checkbox'] {
  margin-right: 0.4em;
  accent-color: var(--accent);
}

.markdown-body blockquote {
  margin: 0.8em 0;
  padding: 0.5em 1em;
  border-left: 3px solid var(--accent);
  background: var(--bg-soft);
  color: var(--text-secondary);
}

.markdown-body blockquote p {
  margin: 0.25em 0;
}

.markdown-body hr {
  margin: 1.2em 0;
  border: 0;
  border-top: 1px solid var(--border);
}

.markdown-body code {
  padding: 0.15em 0.4em;
  border-radius: 4px;
  background: rgba(28, 37, 34, 0.07);
  color: #c0392b;
  font-family: var(--font-mono);
  font-size: 0.88em;
}

.markdown-body pre {
  position: relative;
  margin: 0.9em 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #f7f7f5;
  overflow: hidden;
}

.markdown-body pre .code-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  background: #efefec;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
}

.markdown-body pre .code-lang {
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.markdown-body pre .code-copy {
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-raised);
  color: var(--text-secondary);
  font-family: var(--font-sans);
  font-size: 11px;
}

.markdown-body pre .code-copy:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.markdown-body pre .code-copy.copied {
  border-color: var(--teal);
  color: var(--teal);
}

.markdown-body pre code {
  display: block;
  padding: 12px 14px;
  overflow-x: auto;
  background: transparent;
  color: #2b3531;
  font-size: 12px;
  line-height: 1.7;
  white-space: pre;
}

.markdown-body table {
  margin: 0.9em 0;
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  overflow: hidden;
  border-radius: 8px;
}

.markdown-body th,
.markdown-body td {
  padding: 7px 12px;
  border: 1px solid var(--border);
  text-align: left;
}

.markdown-body th {
  background: var(--bg-soft);
  font-weight: 600;
}

.markdown-body tr:nth-child(even) td {
  background: rgba(28, 37, 34, 0.025);
}

.markdown-body a {
  color: var(--accent);
  text-decoration: none;
}

.markdown-body a:hover {
  text-decoration: underline;
}

.markdown-body img {
  max-width: 100%;
  border-radius: 8px;
}

.markdown-body del {
  color: var(--text-muted);
}
</style>
