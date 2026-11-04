<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ArrowRight, Boxes, Cpu, KeyRound, ShieldCheck, Terminal } from 'lucide-vue-next'
import { login } from '../store'

const mode = ref<'login' | 'register'>('login')
const name = ref('陈工')
const email = ref('chen@team.local')
const password = ref('')
const error = ref('')

function submit(): void {
  if (!email.value.trim() || !password.value.trim()) {
    error.value = '请填写账号名和口令'
    return
  }
  error.value = ''
  login(name.value.trim() || email.value.split('@')[0], email.value.trim())
}

function demoEnter(): void {
  login('演示用户', 'demo@exitcode.local')
}

onMounted(() => {
  if (new URLSearchParams(window.location.search).get('demo') === '1') {
    demoEnter()
  }
})
</script>

<template>
  <main class="login-shell">
    <section class="brand-panel">
      <div class="brand-top">
        <span class="logo-mark"><Terminal :size="18" /></span>
        <span class="brand-name">ExitcodeAgent</span>
      </div>

      <p class="eyebrow">自托管 智能体 协作</p>
      <h1>让智能体在隔离沙箱里把活干完</h1>
      <p class="lead">对话驱动的工作台：智能体负责读代码、执行命令、改文件和提交，你负责确认方向。</p>

      <div class="status-matrix">
        <div class="status-cell">
          <span class="status-icon"><Cpu :size="16" /></span>
          <div>
            <span class="status-label">沙箱节点</span>
            <strong><span class="dot"></span> 在线</strong>
          </div>
        </div>
        <div class="status-cell">
          <span class="status-icon"><KeyRound :size="16" /></span>
          <div>
            <span class="status-label">模型密钥</span>
            <strong>1 个自管</strong>
          </div>
        </div>
        <div class="status-cell">
          <span class="status-icon"><ShieldCheck :size="16" /></span>
          <div>
            <span class="status-label">会话隔离</span>
            <strong>容器级</strong>
          </div>
        </div>
        <div class="status-cell">
          <span class="status-icon"><Boxes :size="16" /></span>
          <div>
            <span class="status-label">项目空间</span>
            <strong>2 个挂载</strong>
          </div>
        </div>
      </div>
    </section>

    <section class="form-panel">
      <div class="form-wrap">
        <h2>进入工作台</h2>
        <p class="form-hint">演示环境，任意账号和口令即可进入。</p>

        <div class="mode-tabs" role="tablist">
          <button :class="{ active: mode === 'login' }" type="button" @click="mode = 'login'">登录</button>
          <button :class="{ active: mode === 'register' }" type="button" @click="mode = 'register'">注册</button>
        </div>

        <form class="login-form" @submit.prevent="submit">
          <label v-if="mode === 'register'" class="form-field">
            <span>姓名</span>
            <input v-model="name" class="field" type="text" placeholder="你的名字" autocomplete="name" />
          </label>
          <label class="form-field">
            <span>邮箱或用户名</span>
            <input v-model="email" class="field" type="text" placeholder="you@team.local" autocomplete="username" />
          </label>
          <label class="form-field">
            <span>口令</span>
            <input v-model="password" class="field" type="password" placeholder="••••••••" autocomplete="current-password" />
          </label>
          <p v-if="error" class="form-error">{{ error }}</p>
          <button class="btn-primary submit-btn" type="submit">
            {{ mode === 'login' ? '登录' : '创建账号' }}
            <ArrowRight :size="16" />
          </button>
        </form>

        <div class="divider"><span>或</span></div>
        <button class="btn-ghost demo-btn" type="button" @click="demoEnter">直接进入演示工作台</button>
      </div>
    </section>
  </main>
</template>

<style scoped>
.login-shell {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(380px, 0.85fr);
  min-height: 100%;
  background: var(--bg);
}

.brand-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: clamp(40px, 7vw, 96px);
  overflow: hidden;
  background:
    linear-gradient(rgba(245, 238, 227, 0.045) 1px, transparent 1px),
    linear-gradient(90deg, rgba(245, 238, 227, 0.045) 1px, transparent 1px),
    var(--bg-soft);
  background-size: 44px 44px;
  border-right: 1px solid var(--border);
}

.brand-panel::after {
  content: '';
  position: absolute;
  inset: auto -16% -44% 28%;
  height: 70%;
  border: 1px solid rgba(255, 106, 43, 0.24);
  border-radius: 50%;
  transform: rotate(-12deg);
  pointer-events: none;
}

.brand-top {
  position: absolute;
  top: 32px;
  left: clamp(40px, 7vw, 96px);
  display: flex;
  align-items: center;
  gap: 10px;
}

.logo-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: var(--radius-s);
  background: var(--accent);
  color: #1b0d04;
}

.brand-name {
  font-weight: 700;
  letter-spacing: 0;
}

.eyebrow {
  color: var(--accent);
  font-weight: 600;
  margin-bottom: 14px;
}

h1 {
  max-width: 560px;
  margin: 0 0 18px;
  font-size: clamp(30px, 4.4vw, 52px);
  line-height: 1.08;
  font-weight: 720;
  letter-spacing: 0;
}

.lead {
  max-width: 500px;
  color: var(--text-secondary);
  font-size: 16px;
}

.status-matrix {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 1px;
  max-width: 560px;
  margin-top: 44px;
  border: 1px solid var(--border);
  background: var(--border);
}

.status-cell {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 14px;
  background: var(--bg-soft);
}

.status-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-s);
  background: rgba(245, 238, 227, 0.06);
  color: var(--text-secondary);
  flex: none;
}

.status-cell div {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.status-label {
  color: var(--text-muted);
  font-size: 12px;
}

.status-cell strong {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin-top: 2px;
  font-size: 13px;
}

.form-panel {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
}

.form-wrap {
  width: min(400px, 100%);
}

h2 {
  margin: 0 0 6px;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0;
}

.form-hint {
  color: var(--text-muted);
  font-size: 13px;
}

.mode-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 3px;
  margin: 26px 0 20px;
  padding: 3px;
  border: 1px solid var(--border);
  border-radius: var(--radius-s);
  background: var(--bg-inset);
}

.mode-tabs button {
  padding: 8px;
  border-radius: var(--radius-s);
  color: var(--text-muted);
  font-weight: 600;
}

.mode-tabs button.active {
  background: var(--bg-raised);
  color: var(--text);
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-field span {
  font-size: 13px;
  color: var(--text-secondary);
}

.form-error {
  color: var(--danger);
  font-size: 13px;
}

.submit-btn {
  margin-top: 6px;
}

.divider {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 22px 0 14px;
  color: var(--text-muted);
  font-size: 12px;
}

.divider::before,
.divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border);
}

.demo-btn {
  width: 100%;
}

@media (max-width: 900px) {
  .login-shell {
    grid-template-columns: 1fr;
  }

  .brand-panel {
    min-height: 320px;
    padding: 88px 28px 36px;
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }

  .brand-top {
    left: 28px;
  }

  .status-matrix {
    max-width: none;
    margin-top: 28px;
  }

  .form-panel {
    padding: 36px 24px 56px;
  }
}
</style>
