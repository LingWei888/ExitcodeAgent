import { randomUUID } from 'node:crypto'

// 零依赖图形验证码：内存存储 4 位字符码，输出噪声 SVG，验证一次即失效
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 4
const TTL_MS = 5 * 60 * 1000
const CHAR_COLORS = ['#18181b', '#3f3f46', '#5443ba', '#276749', '#8a2c2c']

const store = new Map()

function randomCode() {
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  }
  return code
}

export function createCaptcha() {
  const id = randomUUID()
  const code = randomCode()
  store.set(id, { code, expires: Date.now() + TTL_MS })
  const timer = setTimeout(() => store.delete(id), TTL_MS + 1000)
  timer.unref?.()
  return id
}

export function getCaptchaCode(id) {
  const entry = store.get(String(id || ''))
  if (!entry || entry.expires < Date.now()) return null
  return entry.code
}

export function verifyCaptcha(id, input) {
  const entry = store.get(String(id || ''))
  if (!entry || entry.expires < Date.now()) return false
  store.delete(id)
  return typeof input === 'string' && input.trim().toUpperCase() === entry.code
}

function esc(text) {
  return String(text).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)
}

export function captchaSvg(code) {
  const width = 150
  const height = 50
  const chars = String(code).split('')
  let body = ''
  // 干扰线
  for (let i = 0; i < 5; i++) {
    const x1 = Math.floor(Math.random() * 30)
    const y1 = Math.floor(Math.random() * height)
    const x2 = width - Math.floor(Math.random() * 30)
    const y2 = Math.floor(Math.random() * height)
    body += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#b6b6c2" stroke-width="1" />`
  }
  // 噪点
  for (let i = 0; i < 46; i++) {
    const x = Math.floor(Math.random() * width)
    const y = Math.floor(Math.random() * height)
    body += `<circle cx="${x}" cy="${y}" r="${Math.random() < 0.5 ? 0.6 : 1.1}" fill="#a3a3b0" />`
  }
  // 字符（随机旋转/偏移/颜色）
  chars.forEach((ch, i) => {
    const x = 22 + i * 30 + Math.floor(Math.random() * 8 - 4)
    const y = 34 + Math.floor(Math.random() * 10 - 5)
    const rot = (Math.random() * 0.7 - 0.35).toFixed(2)
    const color = CHAR_COLORS[i % CHAR_COLORS.length]
    body += `<text x="${x}" y="${y}" transform="rotate(${rot} ${x} ${y})" font-family="Consolas, Menlo, monospace" font-size="26" font-weight="700" fill="${color}">${esc(ch)}</text>`
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#f4f4f5"/>${body}</svg>`
}