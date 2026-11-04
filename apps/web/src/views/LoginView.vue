<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Boxes, KeyRound, LockKeyhole, ShieldCheck, Terminal } from 'lucide-vue-next'
import { hasLocalAccount } from '../services/secureStore'
import { setupAccount, unlockAccount } from '../store'

const hasAccount = ref(false)
const busy = ref(false)
const error = ref('')

const name = ref('')
const password = ref('')
const confirmPassword = ref('')

onMounted(async () => {
  try {
    hasAccount.value = await hasLocalAccount()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法连接服务端。'
  }
})

async function submit(): Promise<void> {
  if (busy.value) return
  error.value = ''

  if (!hasAccount.value) {
    if (!name.value.trim()) {
      error.value = '请填写服务器账号名称。'
      return
    }
    if (password.value.length < 8) {
      error.value = '口令至少 8 位。'
      return
    }
    if (password.value !== confirmPassword.value) {
      error.value = '两次输入的口令不一致。'
      return
    }
    busy.value = true
    try {
      await setupAccount(name.value, password.value)
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '创建账号失败。'
    } finally {
      busy.value = false
    }
    return
  }

  if (!password.value) {
    error.value = '请输入口令。'
    return
  }
  busy.value = true
  try {
    await unlockAccount(password.value)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '解锁失败。'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="login-shell">
    <section class="brand-panel">
      <div class="brand-top">
        <span class="logo-mark"><Terminal :size="18" /></span>
        <span class="brand-name">ExitcodeAgent</span>
      </div>

      <p class="eyebrow">服务器 加密 工作台</p>
      <h1>一份数据，一个账号，全部留在服务器</h1>
      <p class="lead">项目、会话、模型密钥和口令都由服务器加密保管。解锁后由服务器转发 Claude、DeepSeek 或 Ollama 请求。</p>

      <div class="status-matrix">
        <div class="status-cell">
          <span class="status-icon"><ShieldCheck :size="16" /></span>
          <div>
            <span class="status-label">服务器存储</span>
            <strong><span class="dot"></span> 加密保存</strong>
          </div>
        </div>
        <div class="status-cell">
          <span class="status-icon"><LockKeyhole :size="16" /></span>
          <div>
            <span class="status-label">唯一账号</span>
            <strong>仅一个</strong>
          </div>
        </div>
        <div class="status-cell">
          <span class="status-icon"><KeyRound :size="16" /></span>
          <div>
            <span class="status-label">历史记录</span>
            <strong>服务器保留</strong>
          </div>
        </div>
        <div class="status-cell">
          <span class="status-icon"><Boxes :size="16" /></span>
          <div>
            <span class="status-label">模型接入</span>
            <strong>直连可用</strong>
          </div>
        </div>
      </div>
    </section>

    <section class="form-panel">
      <div class="form-wrap">
        <template v-if="!hasAccount">
          <h2>首次设置</h2>
          <p class="form-hint">服务器只会创建一个账号，创建后不再提供注册入口。</p>

          <form class="login-form" @submit.prevent="submit">
            <label class="form-field">
              <span>账号名称</span>
              <input v-model="name" class="field" type="text" placeholder="你的名字" autocomplete="username" />
            </label>
            <label class="form-field">
              <span>口令</span>
              <input v-model="password" class="field" type="password" placeholder="至少 8 位" autocomplete="new-password" />
            </label>
            <label class="form-field">
              <span>确认口令</span>
              <input v-model="confirmPassword" class="field" type="password" placeholder="再次输入" autocomplete="new-password" />
            </label>
            <p v-if="error" class="form-error">{{ error }}</p>
            <button class="btn-primary submit-btn" type="submit" :disabled="busy">
              {{ busy ? '创建中' : '创建服务器账号' }}
            </button>
          </form>
        </template>

        <template v-else>
          <h2>解锁服务器工作台</h2>
          <p class="form-hint">输入服务器账号口令解锁加密数据。</p>

          <form class="login-form" @submit.prevent="submit">
            <label class="form-field">
              <span>口令</span>
              <input v-model="password" class="field" type="password" placeholder="••••••••" autocomplete="current-password" />
            </label>
            <p v-if="error" class="form-error">{{ error }}</p>
            <button class="btn-primary submit-btn" type="submit" :disabled="busy">
              {{ busy ? '解锁中' : '解锁' }}
            </button>
          </form>
        </template>
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
    linear-gradient(rgba(28, 37, 34, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(28, 37, 34, 0.05) 1px, transparent 1px),
    var(--bg-soft);
  background-size: 44px 44px;
  border-right: 1px solid var(--border);
}

.brand-panel::after {
  content: '';
  position: absolute;
  inset: auto -16% -44% 28%;
  height: 70%;
  border: 1px solid rgba(223, 79, 30, 0.24);
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
}

.lead {
  max-width: 500px;
  color: var(--text-secondary);
  font-size: 16px;
}

.status-matrix {
  display: flex;
  flex-direction: column;
  max-width: 460px;
  margin-top: 44px;
  border-top: 1px solid var(--border);
}

.status-cell {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
  background: transparent;
}

.status-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-s);
  background: rgba(28, 37, 34, 0.06);
  color: var(--text-secondary);
  flex: none;
}

.status-cell div {
  display: flex;
  flex-direction: column;
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
}

.form-hint {
  color: var(--text-muted);
  font-size: 13px;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 26px;
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
