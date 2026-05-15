<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

type Direction = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT'

const canvas = ref<HTMLCanvasElement>()
const joystickRef = ref<HTMLElement>()

const snake = ref<{ x: number; y: number }[]>([{ x: 10, y: 10 }])
const direction = ref<Direction>('RIGHT')
const nextDirection = ref<Direction>('RIGHT')

type FoodType = { color: string; points: number }

const FOOD_TYPES: FoodType[] = [
  { color: '#FF0000', points: 1 },
  { color: '#FF7F00', points: 2 },
  { color: '#FFFF00', points: 3 },
  { color: '#00FF00', points: 4 },
  { color: '#0000FF', points: 5 },
  { color: '#4B0082', points: 6 },
  { color: '#8B00FF', points: 7 },
]

type FoodItem = { x: number; y: number; type: FoodType }

const foods = ref<FoodItem[]>([])
const foodSpawnMax = ref(1)

const gameStatus = ref<'idle' | 'playing' | 'paused' | 'gameover'>('idle')
const score = ref(0)
const shields = ref(0)
const shieldActive = ref(false)

const gridRows = 20
const gridCols = ref(20)
const cellSize = ref(0)

const currentSpeed = computed(() => Math.max(50, 150 - Math.floor(score.value / 10) * 5))

const isMobile = ref(false)
const isLandscape = ref(true)

const headImg = new Image()
const bodyImg = new Image()
const imagesLoaded = ref(false)

const jOffsetX = ref(0)
const jOffsetY = ref(0)
const jActive = ref(false)
const joystickDir = ref<Direction | null>(null)

let lastUpdateTime = 0
let animationId = 0
let growCounter = 0
let shieldAnimFrame = 0
let screenFlashAlpha = 0
let floatTexts: { x: number; y: number; text: string; alpha: number; vy: number }[] = []
let snakeGlowTimer = 0
let jCenterX = 0
let jCenterY = 0
let jTouchId = -1

const J_RADIUS = 52

const knobStyle = computed(() => ({
  transform: `translate(${jOffsetX.value}px, ${jOffsetY.value}px)`
}))

let mqPointer: MediaQueryList
let mqOrientation: MediaQueryList

onMounted(() => {
  mqPointer = window.matchMedia('(pointer: coarse)')
  isMobile.value = mqPointer.matches
  mqPointer.addEventListener('change', onPointerChange)

  mqOrientation = window.matchMedia('(orientation: landscape)')
  isLandscape.value = mqOrientation.matches
  mqOrientation.addEventListener('change', onOrientationChange)

  resizeCanvas()
  window.addEventListener('resize', resizeCanvas)

  headImg.src = '/images/snake-head.jpg'
  bodyImg.src = '/images/snake-body.webp'
  Promise.all([
    new Promise<void>(r => { headImg.onload = () => r(); headImg.onerror = () => r() }),
    new Promise<void>(r => { bodyImg.onload = () => r(); bodyImg.onerror = () => r() })
  ]).then(() => {
    imagesLoaded.value = true
    render()
  })
  document.addEventListener('touchstart', onJoystickStart)
  document.addEventListener('touchmove', onJoystickMove, { passive: false })
  document.addEventListener('touchend', onJoystickEnd)
  document.addEventListener('touchcancel', onJoystickEnd)
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  if (mqPointer) mqPointer.removeEventListener('change', onPointerChange)
  if (mqOrientation) mqOrientation.removeEventListener('change', onOrientationChange)
  window.removeEventListener('resize', resizeCanvas)
  document.removeEventListener('touchstart', onJoystickStart)
  document.removeEventListener('touchmove', onJoystickMove)
  document.removeEventListener('touchend', onJoystickEnd)
  document.removeEventListener('touchcancel', onJoystickEnd)
  document.removeEventListener('keydown', handleKeydown)
  cancelAnimationFrame(animationId)
})

function onPointerChange(e: MediaQueryListEvent) {
  isMobile.value = e.matches
}

function onOrientationChange(e: MediaQueryListEvent) {
  isLandscape.value = e.matches
}

function togglePause() {
  if (gameStatus.value === 'playing') {
    gameStatus.value = 'paused'
  } else if (gameStatus.value === 'paused') {
    gameStatus.value = 'playing'
    lastUpdateTime = 0
  }
}

function startGame() {
  const startX = Math.floor(gridCols.value / 2)
  const startY = Math.floor(gridRows / 2)
  snake.value = [{ x: startX, y: startY }]
  direction.value = 'RIGHT'
  nextDirection.value = 'RIGHT'
  score.value = 0
  shields.value = 1
  shieldActive.value = false
  shieldAnimFrame = 0
  growCounter = 0
  screenFlashAlpha = 0
  floatTexts = []
  snakeGlowTimer = 0
  gameStatus.value = 'playing'
  lastUpdateTime = 0
  foods.value = []
  maybeSpawnFood(true)
  cancelAnimationFrame(animationId)
  animationId = requestAnimationFrame(gameLoop)
}

function gameLoop(timestamp: number) {
  if (lastUpdateTime === 0) lastUpdateTime = timestamp

  if (gameStatus.value === 'playing') {
    const speed = currentSpeed.value
    if (timestamp - lastUpdateTime >= speed) {
      direction.value = nextDirection.value
      moveSnake()
      lastUpdateTime = timestamp
    }
  }

  render()
  animationId = requestAnimationFrame(gameLoop)
}

function moveSnake() {
  const head = snake.value[0]
  if (!head) return

  const newHead = { ...head }
  switch (direction.value) {
    case 'RIGHT': newHead.x += 1; break
    case 'LEFT':  newHead.x -= 1; break
    case 'UP':    newHead.y -= 1; break
    case 'DOWN':  newHead.y += 1; break
  }

  if (checkCollision(newHead)) {
    if (shields.value > 0) {
      shields.value--
      triggerShieldEffect()
      const opposites: Record<Direction, Direction> = {
        UP: 'DOWN', DOWN: 'UP', LEFT: 'RIGHT', RIGHT: 'LEFT'
      }
      direction.value = opposites[direction.value]
      nextDirection.value = direction.value
      return
    }
    gameStatus.value = 'gameover'
    return
  }

  snake.value.unshift(newHead)

  const eaten = foods.value.find(f => f.x === newHead.x && f.y === newHead.y)
  if (eaten) {
    const pts = eaten.type.points
    const prevScore = score.value
    score.value += pts
    growCounter += pts
    foods.value = foods.value.filter(f => f !== eaten)
    maybeSpawnFood(false)
    if (Math.floor(score.value / 50) > Math.floor(prevScore / 50)) {
      shields.value++
    }
  }

  if (growCounter > 0) {
    growCounter--
  } else {
    snake.value.pop()
  }
}

function checkCollision(head: { x: number; y: number }): boolean {
  if (head.x < 0 || head.x >= gridCols.value) return true
  if (head.y < 0 || head.y >= gridRows) return true
  return snake.value.some(seg => seg.x === head.x && seg.y === head.y)
}

function maybeSpawnFood(force: boolean) {
  const max = Math.min(Math.max(1, Math.floor(score.value / 10)), 50)
  foodSpawnMax.value = max
  const remaining = foods.value.length

  const spawnChance = (max - remaining) / max
  const shouldSpawn = force || Math.random() < spawnChance
  if (!shouldSpawn) return

  const count = max - remaining
  if (count <= 0) return

  const occupied = new Set(snake.value.map(s => `${s.x},${s.y}`))
  foods.value.forEach(f => occupied.add(`${f.x},${f.y}`))

  const free: { x: number; y: number }[] = []
  for (let x = 0; x < gridCols.value; x++) {
    for (let y = 0; y < gridRows; y++) {
      if (!occupied.has(`${x},${y}`)) free.push({ x, y })
    }
  }

  for (let i = 0; i < count && free.length > 0; i++) {
    const idx = Math.floor(Math.random() * free.length)
    const pos = free.splice(idx, 1)[0]!
    const type = FOOD_TYPES[Math.floor(Math.random() * FOOD_TYPES.length)]!
    foods.value.push({ x: pos.x, y: pos.y, type })
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (gameStatus.value !== 'playing') return
  switch (e.key) {
    case 'ArrowUp':
    case 'w': case 'W':
      e.preventDefault(); changeDirection('UP'); break
    case 'ArrowDown':
    case 's': case 'S':
      e.preventDefault(); changeDirection('DOWN'); break
    case 'ArrowLeft':
    case 'a': case 'A':
      e.preventDefault(); changeDirection('LEFT'); break
    case 'ArrowRight':
    case 'd': case 'D':
      e.preventDefault(); changeDirection('RIGHT'); break
    case ' ':
      e.preventDefault(); togglePause(); break
  }
}

function render() {
  const c = canvas.value
  if (!c) return
  const ctx = c.getContext('2d')
  if (!ctx) return
  const size = cellSize.value
  if (size === 0) return
  const w = window.innerWidth
  const h = window.innerHeight

  ctx.fillStyle = '#1a1a2e'
  ctx.fillRect(0, 0, w, h)

  drawGridLines(ctx, size)
  drawFood(ctx, size)
  drawSnake(ctx, size)
  drawShieldEffect(ctx, size)
}

function triggerShieldEffect() {
  shieldActive.value = true
  shieldAnimFrame = 0
  screenFlashAlpha = 0.5
  snakeGlowTimer = 30

  const head = snake.value[0]
  if (head && cellSize.value > 0) {
    floatTexts.push({
      x: head.x * cellSize.value + cellSize.value / 2,
      y: head.y * cellSize.value,
      text: '🛡️ 護盾！',
      alpha: 1,
      vy: -2,
    })
  }
}

function drawShieldEffect(ctx: CanvasRenderingContext2D, size: number) {
  if (screenFlashAlpha > 0) {
    ctx.fillStyle = `rgba(0, 100, 255, ${screenFlashAlpha})`
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight)
    screenFlashAlpha -= 0.05
  }

  for (let i = floatTexts.length - 1; i >= 0; i--) {
    const ft = floatTexts[i]!
    ft.y += ft.vy
    ft.alpha -= 0.02
    if (ft.alpha <= 0) {
      floatTexts.splice(i, 1)
      continue
    }
    ctx.globalAlpha = ft.alpha
    ctx.font = `bold ${size * 0.8}px sans-serif`
    ctx.textAlign = 'center'
    ctx.fillStyle = '#fff'
    ctx.strokeStyle = '#0066cc'
    ctx.lineWidth = 3
    ctx.strokeText(ft.text, ft.x, ft.y)
    ctx.fillText(ft.text, ft.x, ft.y)
    ctx.globalAlpha = 1
  }

  if (!shieldActive.value) return
  const head = snake.value[0]
  if (!head) return

  const cx = head.x * size + size / 2
  const cy = head.y * size + size / 2
  const maxR = size * 3
  const r = size / 2 + (maxR - size / 2) * shieldAnimFrame
  const alpha = 1 - shieldAnimFrame

  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`
  ctx.lineWidth = 4
  ctx.stroke()

  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.75, 0, Math.PI * 2)
  ctx.strokeStyle = `rgba(0, 150, 255, ${alpha * 0.8})`
  ctx.lineWidth = 3
  ctx.stroke()

  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2)
  ctx.strokeStyle = `rgba(100, 200, 255, ${alpha * 0.5})`
  ctx.lineWidth = 2
  ctx.stroke()

  shieldAnimFrame += 0.03
  if (shieldAnimFrame >= 1) {
    shieldActive.value = false
    shieldAnimFrame = 0
  }
}

function drawGridLines(ctx: CanvasRenderingContext2D, size: number) {
  ctx.strokeStyle = '#252540'
  ctx.lineWidth = 0.5
  for (let x = 0; x <= gridCols.value * size; x += size) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, window.innerHeight)
    ctx.stroke()
  }
  for (let y = 0; y <= gridRows * size; y += size) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(window.innerWidth, y)
    ctx.stroke()
  }
}

function drawFood(ctx: CanvasRenderingContext2D, size: number) {
  foods.value.forEach(f => {
    ctx.fillStyle = f.type.color
    ctx.beginPath()
    ctx.arc(f.x * size + size / 2, f.y * size + size / 2, size / 2 - 2, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)'
    ctx.beginPath()
    ctx.arc(f.x * size + size / 2 - 3, f.y * size + size / 2 - 3, size / 6, 0, Math.PI * 2)
    ctx.fill()
  })
}

function drawSnake(ctx: CanvasRenderingContext2D, size: number) {
  if (snakeGlowTimer > 0) {
    ctx.save()
    ctx.shadowColor = '#0088ff'
    ctx.shadowBlur = 12
    snake.value.forEach(seg => {
      ctx.strokeStyle = 'rgba(0, 150, 255, 0.6)'
      ctx.lineWidth = 2
      ctx.strokeRect(seg.x * size, seg.y * size, size, size)
    })
    ctx.restore()
    snakeGlowTimer--
  }

  snake.value.forEach((seg, i) => {
    const img = i === 0 ? headImg : bodyImg
    if (img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, seg.x * size, seg.y * size, size, size)
    } else {
      ctx.fillStyle = i === 0 ? '#4caf50' : '#388e3c'
      ctx.fillRect(seg.x * size + 1, seg.y * size + 1, size - 2, size - 2)
    }
  })
}

function updateJoystick(cx: number, cy: number) {
  let dx = cx - jCenterX
  let dy = cy - jCenterY
  const dist = Math.sqrt(dx * dx + dy * dy)

  if (dist > J_RADIUS) {
    dx = (dx / dist) * J_RADIUS
    dy = (dy / dist) * J_RADIUS
  }

  jOffsetX.value = dx
  jOffsetY.value = dy

  const deadzone = 12
  if (dist < deadzone) {
    joystickDir.value = null
    return
  }

  const angle = Math.atan2(dy, dx) * (180 / Math.PI)

  let dir: Direction
  if (angle > -45 && angle <= 45) {
    dir = 'RIGHT'
  } else if (angle > 45 && angle <= 135) {
    dir = 'DOWN'
  } else if (angle > 135 || angle <= -135) {
    dir = 'LEFT'
  } else {
    dir = 'UP'
  }

  joystickDir.value = dir
  changeDirection(dir)
}

function onJoystickStart(e: TouchEvent) {
  if (gameStatus.value !== 'playing' || !isMobile.value || !isLandscape.value) return
  const touch = e.touches[0]
  if (!touch) return

  const el = joystickRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2

  const dist = Math.hypot(touch.clientX - cx, touch.clientY - cy)
  if (dist > J_RADIUS * 2.5) return

  jCenterX = cx
  jCenterY = cy
  jTouchId = touch.identifier
  jActive.value = true
  updateJoystick(touch.clientX, touch.clientY)
}

function onJoystickMove(e: TouchEvent) {
  if (!jActive.value) return
  const touch = [...e.changedTouches].find(t => t.identifier === jTouchId)
  if (!touch) return
  e.preventDefault()
  updateJoystick(touch.clientX, touch.clientY)
}

function onJoystickEnd(e: TouchEvent) {
  if (!jActive.value) return
  const touch = [...e.changedTouches].find(t => t.identifier === jTouchId)
  if (!touch) return
  jActive.value = false
  jOffsetX.value = 0
  jOffsetY.value = 0
  joystickDir.value = null
}

function changeDirection(dir: Direction) {
  if (direction.value === 'UP' && dir === 'DOWN') return
  if (direction.value === 'DOWN' && dir === 'UP') return
  if (direction.value === 'LEFT' && dir === 'RIGHT') return
  if (direction.value === 'RIGHT' && dir === 'LEFT') return
  nextDirection.value = dir
}

function resizeCanvas() {
  const c = canvas.value
  if (!c) return
  const dpr = window.devicePixelRatio || 1
  const w = window.innerWidth
  const h = window.innerHeight

  const size = Math.floor(Math.min(w, h) / gridRows)
  cellSize.value = size
  gridCols.value = Math.floor(w / size)

  c.width = w * dpr
  c.height = h * dpr
  c.style.width = `${w}px`
  c.style.height = `${h}px`
  const ctx = c.getContext('2d')
  if (ctx) ctx.scale(dpr, dpr)

  if (gameStatus.value === 'idle' || gameStatus.value === 'gameover') {
    render()
  }
}

</script>

<template>
  <div class="canvas-wrapper">
    <canvas ref="canvas" id="gameCanvas"></canvas>

    <!-- 桌機版 -->
    <template v-if="!isMobile">
      <div class="score-bar">分數：<strong>{{ score }}</strong>　🛡️ {{ shields }}</div>
      <button class="pause-btn pause-btn-desktop" @click="togglePause">
        {{ gameStatus === 'playing' ? '⏸' : '▶' }}
      </button>

      <div class="overlay" v-if="gameStatus !== 'playing'">
        <div class="overlay-content">
          <template v-if="gameStatus === 'idle'">
            <p>🐍 準備開始</p>
            <button class="btn" @click="startGame()">開始遊戲</button>
          </template>
          <template v-else-if="gameStatus === 'paused'">
            <p>⏸️ 已暫停</p>
            <button class="btn" @click="togglePause()">繼續</button>
          </template>
          <template v-else-if="gameStatus === 'gameover'">
            <p>💀 Game Over</p>
            <p class="final-score">分數：{{ score }}</p>
            <button class="btn" @click="startGame()">重新開始</button>
          </template>
        </div>
      </div>

      <div class="controls">
        <button class="dir-btn up" @click="changeDirection('UP')">↑</button>
        <div class="middle-row">
          <button class="dir-btn left" @click="changeDirection('LEFT')">←</button>
          <button class="dir-btn down" @click="changeDirection('DOWN')">↓</button>
          <button class="dir-btn right" @click="changeDirection('RIGHT')">→</button>
        </div>
      </div>
    </template>

    <!-- 手機直立提示 -->
    <template v-else-if="!isLandscape">
      <div class="rotate-hint">
        <div class="rotate-icon">↻</div>
        <p>請旋轉至橫向</p>
      </div>
    </template>

    <!-- 手機橫向遊戲 -->
    <template v-else>
      <div class="score-bar score-bar-mobile">分數：<strong>{{ score }}</strong></div>

      <button class="pause-btn" @click="togglePause">
        {{ gameStatus === 'playing' ? '⏸' : '▶' }}
      </button>

      <div class="joystick" ref="joystickRef">
        <div class="joystick-ring">
          <span class="arrow up">↑</span>
          <span class="arrow right">→</span>
          <span class="arrow down">↓</span>
          <span class="arrow left">←</span>
          <div class="joystick-knob" :class="{ active: jActive }" :style="knobStyle"></div>
        </div>
      </div>

      <div class="overlay" v-if="gameStatus !== 'playing'">
        <div class="overlay-content">
          <template v-if="gameStatus === 'idle'">
            <p>🐍 準備開始</p>
            <button class="btn" @click="startGame()">開始遊戲</button>
          </template>
          <template v-else-if="gameStatus === 'paused'">
            <p>⏸️ 已暫停</p>
            <button class="btn" @click="togglePause()">繼續</button>
          </template>
          <template v-else-if="gameStatus === 'gameover'">
            <p>💀 Game Over</p>
            <p class="final-score">分數：{{ score }}</p>
            <button class="btn" @click="startGame()">重新開始</button>
          </template>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
* {
  box-sizing: border-box;
}

html, body {
  margin: 0;
  padding: 0;
  overscroll-behavior: none;
  -webkit-overflow-scrolling: none;
}

.canvas-wrapper {
  position: fixed;
  inset: 0;
  overflow: hidden;
  touch-action: none;
  -ms-touch-action: none;
}

#gameCanvas {
  display: block;
  background: #1a1a2e;
  touch-action: none;
}

.score-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  padding: 16px 24px;
  padding-top: calc(16px + env(safe-area-inset-top, 0px));
  font-size: 24px;
  font-weight: 600;
  color: #fff;
  background: linear-gradient(to bottom, rgba(0, 0, 0, 0.5), transparent);
  pointer-events: none;
  font-family: 'Segoe UI', sans-serif;
  z-index: 1;
}

.score-bar-mobile {
  font-size: 18px;
  padding: 10px 16px;
  padding-top: calc(10px + env(safe-area-inset-top, 0px));
}

.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  z-index: 3;
}

.overlay-content {
  text-align: center;
  color: #fff;
  font-family: 'Segoe UI', sans-serif;
}

.overlay-content p {
  margin: 0 0 12px;
  font-size: 28px;
}

.final-score {
  font-size: 20px !important;
  opacity: 0.8;
}

.btn {
  padding: 12px 36px;
  font-size: 18px;
  border: none;
  border-radius: 8px;
  background: #4caf50;
  color: #fff;
  cursor: pointer;
  transition: background 0.15s;
}

.btn:hover {
  background: #43a047;
}

.controls {
  position: absolute;
  bottom: calc(24px + env(safe-area-inset-bottom, 0px));
  left: calc(24px + env(safe-area-inset-left, 0px));
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  z-index: 2;
}

.middle-row {
  display: flex;
  gap: 4px;
}

.dir-btn {
  width: 56px;
  height: 56px;
  font-size: 22px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  cursor: pointer;
  backdrop-filter: blur(4px);
  transition: background 0.1s;
}

.dir-btn:hover {
  background: rgba(255, 255, 255, 0.2);
}

.dir-btn:active {
  background: rgba(255, 255, 255, 0.35);
}

.rotate-hint {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-family: 'Segoe UI', sans-serif;
  z-index: 10;
}

.rotate-icon {
  font-size: 64px;
  margin-bottom: 16px;
  animation: rotate 2s ease-in-out infinite;
}

.rotate-hint p {
  font-size: 22px;
  margin: 0;
}

@keyframes rotate {
  0% { transform: rotate(0deg); }
  50% { transform: rotate(90deg); }
  100% { transform: rotate(0deg); }
}

.pause-btn {
  position: absolute;
  top: calc(12px + env(safe-area-inset-top, 0px));
  right: calc(12px + env(safe-area-inset-right, 0px));
  width: 48px;
  height: 48px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.35);
  color: #fff;
  font-size: 22px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(4px);
  z-index: 2;
  transition: background 0.1s;
}

.pause-btn:active {
  background: rgba(255, 255, 255, 0.2);
}

.pause-btn-desktop:hover {
  background: rgba(255, 255, 255, 0.15);
}

.joystick {
  position: absolute;
  bottom: calc(24px + env(safe-area-inset-bottom, 0px));
  left: calc(24px + env(safe-area-inset-left, 0px));
  z-index: 2;
  width: 160px;
  height: 160px;
}

.joystick-ring {
  width: 160px;
  height: 160px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.08);
  border: 2px solid rgba(255, 255, 255, 0.15);
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(4px);
}

.arrow {
  position: absolute;
  font-size: 18px;
  color: rgba(255, 255, 255, 0.35);
  pointer-events: none;
  transition: color 0.1s;
}

.arrow.up {
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
}

.arrow.down {
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
}

.arrow.left {
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
}

.arrow.right {
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
}

.joystick-knob {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.45);
  border: 2px solid rgba(255, 255, 255, 0.6);
  transition: background 0.1s, box-shadow 0.1s;
  will-change: transform;
}

.joystick-knob.active {
  background: rgba(255, 255, 255, 0.6);
  box-shadow: 0 0 12px rgba(255, 255, 255, 0.25);
}
</style>
