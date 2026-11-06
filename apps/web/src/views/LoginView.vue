<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Boxes, Layers, LockKeyhole, RefreshCcw, ShieldCheck } from 'lucide-vue-next'
import { fetchServerState } from '../services/secureStore'
import { newCaptcha } from '../services/api'
import { setupAccount, unlockAccount } from '../store'

const hasAccount = ref(false)
const busy = ref(false)
const error = ref('')

const name = ref('')
const password = ref('')
const confirmPassword = ref('')

const captchaRequired = ref(false)
const captchaId = ref('')
const captchaImgUrl = ref('')
const captcha = ref('')

onMounted(async () => {
  try {
    const state = await fetchServerState()
    hasAccount.value = state.hasAccount
    if (state.captchaRequired) {
      await showCaptcha()
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法连接服务端。'
  }
})

async function showCaptcha(serverId?: string): Promise<void> {
  captchaRequired.value = true
  captcha.value = ''
  if (serverId) {
    captchaId.value = serverId
  } else {
    try {
      captchaId.value = await newCaptcha()
    } catch {
      return
    }
  }
  captchaImgUrl.value = `/api/captcha/${captchaId.value}?t=${Date.now()}`
}

function errorPayload(cause: unknown): { captchaRequired?: boolean; captchaId?: string } | null {
  return (cause as { payload?: { captchaRequired?: boolean; captchaId?: string } })?.payload ?? null
}

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
    await unlockAccount(
      password.value,
      captchaRequired.value ? captcha.value : undefined,
      captchaRequired.value ? captchaId.value : undefined
    )
  } catch (cause) {
    const payload = errorPayload(cause)
    error.value = cause instanceof Error ? cause.message : '解锁失败。'
    if (payload?.captchaRequired) {
      await showCaptcha(payload.captchaId)
    }
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="login-shell">
    <section class="brand-panel">
      <div class="brand-top">
        <span class="logo-mark"><img src="/logo.ico" alt="ExitcodeAgent" /></span>
        <span class="brand-name">ExitcodeAgent</span>
      </div>

      <p class="eyebrow">服务器 AI 智能体</p>
      <h1>面向服务器的 AI 文件与运维智能体</h1>
      <p class="lead">用自然语言管理服务器文件、排查日志、执行运维操作。项目、会话、模型密钥与口令均由服务器加密保管，模型请求由服务器转发。</p>

      <div class="status-matrix">
        <div class="status-cell">
          <span class="status-icon"><Boxes :size="16" /></span>
          <div>
            <span class="status-label">智能文件管理</span>
            <strong>自然语言驱动</strong>
          </div>
        </div>
        <div class="status-cell">
          <span class="status-icon"><ShieldCheck :size="16" /></span>
          <div>
            <span class="status-label">服务器操作助手</span>
            <strong>高危二次确认</strong>
          </div>
        </div>
        <div class="status-cell">
          <span class="status-icon"><Layers :size="16" /></span>
          <div>
            <span class="status-label">插件化扩展</span>
            <strong>按需扩展能力</strong>
          </div>
        </div>
        <div class="status-cell">
          <span class="status-icon"><LockKeyhole :size="16" /></span>
          <div>
            <span class="status-label">安全可控</span>
            <strong>白名单与危险拦截</strong>
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
            <template v-if="captchaRequired">
              <div class="captcha-row">
                <label class="form-field captcha-field">
                  <span>图形验证码</span>
                  <input
                    v-model="captcha"
                    class="field"
                    type="text"
                    placeholder="输入图中字符（不区分大小写）"
                    autocomplete="off"
                    maxlength="4"
                  />
                </label>
                <button class="captcha-img-btn" type="button" title="看不清？点击刷新" @click="showCaptcha()">
                  <img v-if="captchaImgUrl" :src="captchaImgUrl" alt="图形验证码" />
                  <RefreshCcw :size="13" class="captcha-refresh-icon" />
                </button>
              </div>
              <p class="captcha-note">多次输错后需要输入图形验证码，防止密码被暴力破解。</p>
            </template>
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
  border: 1px solid rgba(84, 67, 186, 0.2);
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
}

.logo-mark img {
  width: 34px;
  height: 34px;
  border-radius: 5px;
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

.captcha-row {
  display: flex;
  gap: 10px;
  align-items: flex-end;
}

.captcha-field {
  flex: 1;
}

.captcha-img-btn {
  position: relative;
  flex: none;
  width: 132px;
  height: 40px;
  margin-bottom: 2px;
  border: 1px solid var(--border);
  border-radius: var(--radius-s);
  overflow: hidden;
  background: var(--bg-inset);
  cursor: pointer;
}

.captcha-img-btn img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.captcha-refresh-icon {
  position: absolute;
  right: 5px;
  bottom: 5px;
  color: var(--text-muted);
  background: rgba(255, 255, 255, 0.85);
  border-radius: 50%;
  padding: 2px;
}

.captcha-note {
  margin-top: -6px;
  color: var(--text-muted);
  font-size: 12px;
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
