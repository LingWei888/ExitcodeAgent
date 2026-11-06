<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin } from '@pixiv/three-vrm'
import { agentStatus } from '../store'

// 模型正面朝向：香企鹅模型正面朝 +Z（面向相机），无需旋转；旧配置 π 会显示背面
const BASE_ROTATION = 0
const VRM_URL = '/香企鹅.vrm'

const PET_POS_KEY = 'exitcode-pet-pos'

// 每个状态的目标动画参数（数值字段在帧循环里平滑逼近）
interface AnimTarget {
  bobAmp: number
  bobFreq: number
  hopAmp: number
  hopFreq: number
  swayAmp: number
  swayFreq: number
  headTilt: number
  headPitch: number
  headTurn: number
  headTurnFreq: number
  expr: string | null
  exprWeight: number
}

const TARGETS: Record<string, AnimTarget> = {
  idle: { bobAmp: 0.02, bobFreq: 0.9, hopAmp: 0, hopFreq: 1, swayAmp: 0.12, swayFreq: 0.4, headTilt: 0, headPitch: 0.05, headTurn: 0, headTurnFreq: 0.5, expr: 'relaxed', exprWeight: 0.5 },
  planning: { bobAmp: 0.01, bobFreq: 1, hopAmp: 0, hopFreq: 1, swayAmp: 0.08, swayFreq: 1.1, headTilt: 0.28, headPitch: 0.08, headTurn: 0.55, headTurnFreq: 0.4, expr: null, exprWeight: 0 },
  executing: { bobAmp: 0.03, bobFreq: 2.6, hopAmp: 0.09, hopFreq: 2.8, swayAmp: 0.16, swayFreq: 2, headTilt: 0, headPitch: 0.1, headTurn: 0, headTurnFreq: 1, expr: null, exprWeight: 0 },
  fixing: { bobAmp: 0.04, bobFreq: 3.6, hopAmp: 0.13, hopFreq: 3.8, swayAmp: 0.22, swayFreq: 3, headTilt: 0.12, headPitch: -0.08, headTurn: 0.3, headTurnFreq: 1.8, expr: 'angry', exprWeight: 0.35 },
  approval: { bobAmp: 0.02, bobFreq: 1.2, hopAmp: 0.02, hopFreq: 1, swayAmp: 0.06, swayFreq: 0.8, headTilt: 0.06, headPitch: 0.1, headTurn: 0, headTurnFreq: 1, expr: 'surprised', exprWeight: 0.55 },
  verifying: { bobAmp: 0.015, bobFreq: 1.1, hopAmp: 0, hopFreq: 1, swayAmp: 0.04, swayFreq: 0.5, headTilt: 0.08, headPitch: 0.06, headTurn: 0.5, headTurnFreq: 1.6, expr: null, exprWeight: 0 },
  compacting: { bobAmp: 0.01, bobFreq: 0.5, hopAmp: 0, hopFreq: 1, swayAmp: 0.03, swayFreq: 0.3, headTilt: 0.1, headPitch: 0.18, headTurn: 0, headTurnFreq: 1, expr: 'relaxed', exprWeight: 0.8 },
  error: { bobAmp: 0, bobFreq: 1, hopAmp: 0, hopFreq: 1, swayAmp: 0, swayFreq: 1, headTilt: 0.06, headPitch: -0.38, headTurn: 0, headTurnFreq: 1, expr: 'sad', exprWeight: 0.8 },
  done: { bobAmp: 0.03, bobFreq: 2.4, hopAmp: 0.12, hopFreq: 2.2, swayAmp: 0.3, swayFreq: 1.6, headTilt: 0.1, headPitch: 0.06, headTurn: 0, headTurnFreq: 1, expr: 'happy', exprWeight: 0.85 }
}

const PHASE_TEXT: Record<string, string> = {
  planning: '正在规划',
  executing: '正在干活',
  verifying: '正在验证',
  compacting: '正在压缩历史',
  fixing: '正在自动修复',
  done: '已完成'
}

const APEX = 0.12 // 每帧向目标参数逼近的比例因子
const EXPR_NAMES = [
  'aa', 'angry', 'blink', 'blinkLeft', 'blinkRight', 'ee', 'happy', 'ih',
  'lookDown', 'lookLeft', 'lookRight', 'lookUp', 'neutral', 'oh', 'ou',
  'relaxed', 'sad', 'surprised', 'TaFeiXiao', 'surprise'
]

const canvasEl = ref<HTMLCanvasElement | null>(null)
const loaded = ref(false)
const failed = ref(false)
const detailOpen = ref(false)

// 拖拽定位：位置记忆到 localStorage，未定位时停靠右下角
interface PetPos {
  x: number
  y: number
}

function loadPetPos(): PetPos | null {
  try {
    const raw = localStorage.getItem(PET_POS_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as PetPos
    if (typeof p.x !== 'number' || typeof p.y !== 'number') return null
    const maxX = Math.max(0, window.innerWidth - 168)
    const maxY = Math.max(0, window.innerHeight - 170)
    return { x: Math.min(p.x, maxX), y: Math.min(p.y, maxY) }
  } catch {
    return null
  }
}

const petPos = ref<PetPos | null>(loadPetPos())
const dragging = ref(false)
let dragOrigin = { x: 0, y: 0, pos: { x: 0, y: 0 } }
let dragged = false

const wrapStyle = computed(() => {
  if (petPos.value) {
    const pos = petPos.value
    return { left: `${pos.x}px`, top: `${pos.y}px`, right: '', bottom: '' }
  }
  return { left: '', top: '', right: '18px', bottom: '118px' }
})

function onDragStart(event: PointerEvent): void {
  const btn = event.currentTarget as HTMLElement
  const rect = btn.getBoundingClientRect()
  dragOrigin = { x: event.clientX, y: event.clientY, pos: { x: rect.left, y: rect.top } }
  dragged = false
  dragging.value = true
  try {
    btn.setPointerCapture(event.pointerId)
  } catch {
    // 指针捕获失败时仍可拖动（仅限指针在按钮内移动）
  }
}

function onDragMove(event: PointerEvent): void {
  if (!dragging.value) return
  const dx = event.clientX - dragOrigin.x
  const dy = event.clientY - dragOrigin.y
  if (!dragged && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
    dragged = true
  }
  if (!dragged) return
  const btn = event.currentTarget as HTMLElement
  const w = btn.offsetWidth
  const h = btn.offsetHeight
  const x = Math.max(0, Math.min(window.innerWidth - w - 8, dragOrigin.pos.x + dx))
  const y = Math.max(0, Math.min(window.innerHeight - h - 8, dragOrigin.pos.y + dy))
  petPos.value = { x, y }
}

function onDragEnd(): void {
  if (!dragging.value) return
  dragging.value = false
  if (petPos.value) {
    try {
      localStorage.setItem(PET_POS_KEY, JSON.stringify(petPos.value))
    } catch {
      // 存储失败仅影响下次会话的位置记忆
    }
  }
  if (dragged) {
    suppressClick = true
    setTimeout(() => (suppressClick = false), 0)
  }
}

let suppressClick = false
function toggleDetail(): void {
  if (suppressClick) return
  detailOpen.value = !detailOpen.value
}
let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let vrm: any = null
let raf = 0
let disposed = false
const clock = new THREE.Clock()
let nextBlinkAt = 0
let blinkingUntil = 0

let anim: AnimTarget = { ...TARGETS.idle }

const stateName = computed<string>(() => {
  const s = agentStatus
  if (s.approvalPending) return 'approval'
  if (!s.running) return 'idle'
  if (s.phase && TARGETS[s.phase]) return s.phase
  return 'executing'
})

const badgeText = computed(() => {
  const s = agentStatus
  const name = stateName.value
  if (name === 'approval') return '等你确认'
  if (name === 'error') return '出了点问题'
  if (name === 'idle') return '待机中'
  if (name === 'done') return '已完成'
  const round = s.stepIndex ? `第 ${s.stepIndex}${s.stepTotal ? `/${s.stepTotal}` : ''} 回合` : ''
  return `${PHASE_TEXT[name] ?? '正在干活'}${round ? ` · ${round}` : ''}`
})

const badgeClass = computed(() => stateName.value)

const detailLines = computed(() => {
  const s = agentStatus
  const name = stateName.value
  return [
    { k: '状态', v: name === 'approval' ? '等待你批准命令' : PHASE_TEXT[name] ?? (s.running ? '正在干活' : '待机') },
    { k: '回合', v: s.stepIndex ? `${s.stepIndex}${s.stepTotal ? ` / ${s.stepTotal}` : ''}` : '—' },
    { k: '最近工具', v: s.currentToolTitle || '—' }
  ]
})

function currentTarget(): AnimTarget {
  return TARGETS[stateName.value] ?? TARGETS.executing
}

function animate(): void {
  if (disposed) return
  raf = requestAnimationFrame(animate)
  if (!vrm || !renderer || !camera || !scene) return
  const delta = Math.min(clock.getDelta(), 0.1)
  const t = clock.getElapsedTime()
  const target = currentTarget()

  // 数值字段平滑逼近目标
  for (const key of Object.keys(target) as Array<keyof AnimTarget>) {
    if (key === 'expr') continue
    const current = anim[key] as number
    const next = target[key] as number
    const k = Math.min(1, APEX + delta * 4)
    ;(anim as any)[key] = current + (next - current) * k
  }

  const bob = anim.bobAmp * Math.sin(t * anim.bobFreq * Math.PI * 2)
  const hop = anim.hopAmp * (Math.sin(t * anim.hopFreq * Math.PI * 2) * 0.5 + 0.5)
  const sway = anim.swayAmp * Math.sin(t * anim.swayFreq * Math.PI * 2)
  const headTurn = anim.headTurn * Math.sin(t * anim.headTurnFreq * Math.PI * 2)

  vrm.scene.position.y = bob + hop
  vrm.scene.rotation.y = BASE_ROTATION + sway

  const humanoid = vrm.humanoid
  const head = humanoid?.getNormalizedBoneNode?.('head')
  const neck = humanoid?.getNormalizedBoneNode?.('neck')
  if (neck) neck.rotation.set(0, 0, 0)
  if (head) head.rotation.set(anim.headPitch, headTurn, anim.headTilt)

  // 表情：先清零再设目标权重（叠加眨眼）
  const mgr = vrm.expressionManager
  if (mgr) {
    for (const name of EXPR_NAMES) mgr.setValue(name, 0)
    if (target.expr && mgr.getExpression?.(target.expr)) {
      mgr.setValue(target.expr, target.exprWeight)
    }
    const now = performance.now()
    if (now >= nextBlinkAt) {
      blinkingUntil = now + 140
      nextBlinkAt = now + 2600 + Math.random() * 3400
    }
    if (now < blinkingUntil) mgr.setValue('blink', 0.75)
  }

  vrm.update?.(delta)
  renderer.render(scene, camera)
}

function startLoop(): void {
  if (raf) cancelAnimationFrame(raf)
  raf = requestAnimationFrame(animate)
}

function stopLoop(): void {
  if (raf) cancelAnimationFrame(raf)
  raf = 0
}

function initScene(): void {
  const canvas = canvasEl.value
  if (!canvas) return
  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100)
  camera.position.set(0, 1.15, 2.4)
  camera.lookAt(0, 1, 0)
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(160, 160, false)

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.1))
  const key = new THREE.DirectionalLight(0xffffff, 1.6)
  key.position.set(1.5, 2.4, 2)
  scene.add(key)

  const loader = new GLTFLoader()
  loader.register((parser) => new VRMLoaderPlugin(parser))
  loader.load(
    VRM_URL,
    (gltf) => {
      if (disposed) return
      vrm = gltf.userData.vrm
      vrm.scene.rotation.y = 0
      scene?.add(vrm.scene)
      const box = new THREE.Box3().setFromObject(vrm.scene)
      const size = box.getSize(new THREE.Vector3()).length()
      if (camera) {
        camera.position.set(0, box.getCenter(new THREE.Vector3()).y, size * 2.1)
        camera.near = size * 0.02
        camera.far = size * 30
        camera.updateProjectionMatrix()
        camera.lookAt(0, box.getCenter(new THREE.Vector3()).y, 0)
      }
      loaded.value = true
      nextBlinkAt = performance.now() + 1500
      startLoop()
    },
    undefined,
    () => {
      failed.value = true
    }
  )
}

function onVisibility(): void {
  if (document.hidden) stopLoop()
  else if (vrm && !disposed) startLoop()
}

onMounted(() => {
  initScene()
  document.addEventListener('visibilitychange', onVisibility)
})

onBeforeUnmount(() => {
  disposed = true
  stopLoop()
  document.removeEventListener('visibilitychange', onVisibility)
  renderer?.dispose()
  vrm?.scene?.traverse?.((obj: THREE.Object3D) => {
    const mesh = obj as THREE.Mesh
    if (mesh.isMesh) mesh.geometry?.dispose?.()
  })
})
</script>

<template>
  <div class="pet-wrap" :style="wrapStyle">
    <div v-if="detailOpen" class="pet-detail">
      <div v-for="line in detailLines" :key="line.k" class="d-row">
        <span class="d-key">{{ line.k }}</span>
        <span class="d-val">{{ line.v }}</span>
      </div>
    </div>
    <button
      class="pet-btn"
      type="button"
      title="虚拟宠物：点击查看当前状态，按住可拖动位置"
      @click="toggleDetail"
      @pointerdown="onDragStart"
      @pointermove="onDragMove"
      @pointerup="onDragEnd"
      @pointercancel="onDragEnd"
    >
      <canvas ref="canvasEl" class="pet-canvas" width="160" height="160"></canvas>
      <span v-if="!loaded" class="pet-placeholder">{{ failed ? '🐧 加载失败' : '🐧' }}</span>
    </button>
    <div class="pet-badge" :class="badgeClass">{{ badgeText }}</div>
  </div>
</template>

<style scoped>
.pet-wrap {
  position: fixed;
  z-index: 18;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  pointer-events: none;
}

.pet-btn {
  position: relative;
  width: 160px;
  height: 160px;
  pointer-events: auto;
  border-radius: 18px;
  background: transparent;
  border: 0;
  cursor: grab;
  touch-action: none;
}

.pet-btn:active {
  cursor: grabbing;
}

.pet-canvas {
  width: 160px;
  height: 160px;
  display: block;
}

.pet-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 52px;
}

.pet-badge {
  pointer-events: auto;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-soft);
  color: var(--text-secondary);
  font-size: 11px;
  white-space: nowrap;
}

.pet-badge.approval {
  border-color: rgba(15, 133, 118, 0.45);
  color: var(--teal);
  background: var(--teal-soft);
  font-weight: 700;
}

.pet-badge.error {
  border-color: rgba(217, 67, 67, 0.4);
  color: var(--danger);
}

.pet-badge.done {
  color: var(--teal);
}

.pet-detail {
  pointer-events: auto;
  min-width: 180px;
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-soft);
  box-shadow: var(--shadow-pop, 0 8px 24px rgba(0, 0, 0, 0.12));
  font-size: 11px;
}

.d-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 3px 0;
}

.d-row + .d-row {
  border-top: 1px dashed var(--border);
}

.d-key {
  color: var(--text-muted);
  flex: none;
}

.d-val {
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 130px;
}
</style>