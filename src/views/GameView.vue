<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useAuthStore } from '../stores/auth'
import { useScoreStore } from '../stores/score'

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

const auth = useAuthStore()
const scoreStore = useScoreStore()

const gameStatus = ref<'idle' | 'playing' | 'paused' | 'gameover'>('idle')
const score = ref(0)
const shields = ref(0)
const shieldActive = ref(false)

const gridRows = 13
const gridCols = ref(14)
const cellSize = ref(0)

const currentSpeed = computed(() => Math.max(80, 105 - Math.floor(Math.min(score.value, 50) / 10) * 5))

const isMobile = ref(false)
const isLandscape = ref(true)

const headImg = new Image()
const headImg2 = new Image()
const bodyImg = new Image()
const deadHeadImg = new Image()
const imagesLoaded = ref(false)
let headSwapTimer = 0
let headToggle = false

const jOffsetX = ref(0)
const jOffsetY = ref(0)
const jActive = ref(false)
const joystickDir = ref<Direction | null>(null)

const isFullscreen = ref(false)

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    const el = document.documentElement
    if (el.requestFullscreen) {
      el.requestFullscreen()
    } else if ((el as any).webkitRequestFullscreen) {
      (el as any).webkitRequestFullscreen()
    } else if ((el as any).msRequestFullscreen) {
      (el as any).msRequestFullscreen()
    }
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen()
    } else if ((document as any).webkitExitFullscreen) {
      (document as any).webkitExitFullscreen()
    } else if ((document as any).msExitFullscreen) {
      (document as any).msExitFullscreen()
    }
  }
}

function onFullscreenChange() {
  isFullscreen.value = !!document.fullscreenElement
    || !!(document as any).webkitFullscreenElement
    || !!(document as any).msFullscreenElement
}

let lastUpdateTime = 0
let animationId = 0
let growCounter = 0
let prevSnake: { x: number; y: number }[] = []
let deadByWall = false
let shieldAnimFrame = 0
let screenFlashAlpha = 0
let floatTexts: { x: number; y: number; text: string; alpha: number; vy: number }[] = []
let shieldGainTexts: { x: number; y: number; text: string; alpha: number; vy: number; vx: number; color: string }[] = []
let snakeGlowTimer = 0
let shieldGainGlow = 0
let shieldGainFlashAlpha = 0
const phantoms = ref(0)
const phantomActive = ref(false)
let phantomEndTime = 0
let phantomAnim = 0
const PHANTOM_LIFETIME = 10000
const SKILL_TYPES_COUNT = 4
type SkillItem = { x: number; y: number; spawnTime: number }
const phantomItems = ref<SkillItem[]>([])
const shieldItems = ref<SkillItem[]>([])
const dietItems = ref<SkillItem[]>([])
const magnetItems = ref<SkillItem[]>([])
let shieldItemAnim = 0
let dietItemAnim = 0
let dietHeadEndTime = 0
let magnetActive = false
let magnetEndTime = 0
let magnetAnim = 0
let jCenterX = 0
let jCenterY = 0
let jTouchId = -1

const J_RADIUS = 39

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

  headImg.src = `${import.meta.env.BASE_URL}images/snake-head.jpg`
  headImg2.src = `${import.meta.env.BASE_URL}images/snake-head2.jpg`
  bodyImg.src = `${import.meta.env.BASE_URL}images/snake-body.jpg`
  deadHeadImg.src = `${import.meta.env.BASE_URL}images/snake-head-dead.jpg`
  Promise.all([
    new Promise<void>(r => { headImg.onload = () => r(); headImg.onerror = (e) => { console.error('蛇頭1載入失敗', e); r() } }),
    new Promise<void>(r => { headImg2.onload = () => r(); headImg2.onerror = (e) => { console.error('蛇頭2載入失敗', e); r() } }),
    new Promise<void>(r => { bodyImg.onload = () => r(); bodyImg.onerror = (e) => { console.error('蛇身載入失敗', e); r() } }),
    new Promise<void>(r => { deadHeadImg.onload = () => r(); deadHeadImg.onerror = (e) => { console.error('死亡蛇頭載入失敗', e); r() } })
  ]).then(() => {
    imagesLoaded.value = true
    render()
  })
  scoreStore.refresh()
  document.addEventListener('touchstart', onJoystickStart)
  document.addEventListener('touchmove', onJoystickMove, { passive: false })
  document.addEventListener('touchend', onJoystickEnd)
  document.addEventListener('touchcancel', onJoystickEnd)
  document.addEventListener('keydown', handleKeydown)
  document.addEventListener('fullscreenchange', onFullscreenChange)
  document.addEventListener('webkitfullscreenchange', onFullscreenChange)
  document.addEventListener('MSFullscreenChange', onFullscreenChange)
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
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  document.removeEventListener('webkitfullscreenchange', onFullscreenChange)
  document.removeEventListener('MSFullscreenChange', onFullscreenChange)
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
  prevSnake = [{ x: startX, y: startY }]
  direction.value = 'RIGHT'
  nextDirection.value = 'RIGHT'
  score.value = 0
  shields.value = 1
  deadByWall = false
  shieldActive.value = false
  shieldAnimFrame = 0
  growCounter = 0
  screenFlashAlpha = 0
  floatTexts = []
  shieldGainTexts = []
  shieldGainGlow = 0
  shieldGainFlashAlpha = 0
  phantoms.value = 0
  phantomActive.value = false
  phantomEndTime = 0
  phantomItems.value = []
  shieldItems.value = []
  dietItems.value = []
  magnetItems.value = []
  shieldItemAnim = 0
  dietItemAnim = 0
  dietHeadEndTime = 0
  magnetActive = false
  magnetEndTime = 0
  magnetAnim = 0
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

  if (phantomActive.value && timestamp >= phantomEndTime) {
    phantomActive.value = false
  }

  if (magnetActive && timestamp >= magnetEndTime) {
    magnetActive = false
  }

  phantomItems.value = phantomItems.value.filter(item => timestamp - item.spawnTime < PHANTOM_LIFETIME)
  shieldItems.value = shieldItems.value.filter(item => timestamp - item.spawnTime < PHANTOM_LIFETIME)
  dietItems.value = dietItems.value.filter(item => timestamp - item.spawnTime < PHANTOM_LIFETIME)
  magnetItems.value = magnetItems.value.filter(item => timestamp - item.spawnTime < PHANTOM_LIFETIME)

  if (headSwapTimer === 0) headSwapTimer = timestamp
  if (timestamp - headSwapTimer >= 500) {
    headToggle = !headToggle
    headSwapTimer = timestamp
  }

  const progress = gameStatus.value === 'playing' ? Math.min((timestamp - lastUpdateTime) / currentSpeed.value, 1) : 1
  render(progress)
  animationId = requestAnimationFrame(gameLoop)
}

function moveSnake() {
  prevSnake = snake.value.map(s => ({ ...s }))
  const head = snake.value[0]
  if (!head) return

  const newHead = { ...head }
  switch (direction.value) {
    case 'RIGHT': newHead.x += 1; break
    case 'LEFT':  newHead.x -= 1; break
    case 'UP':    newHead.y -= 1; break
    case 'DOWN':  newHead.y += 1; break
  }

  const isWall = newHead.x < 0 || newHead.x >= gridCols.value || newHead.y < 0 || newHead.y >= gridRows
  const isSelf = !isWall && !phantomActive.value && snake.value.some(seg => seg.x === newHead.x && seg.y === newHead.y)

  if (isWall || isSelf) {
    if (isSelf && phantoms.value > 0) {
      phantoms.value--
      phantomActive.value = true
      phantomEndTime = performance.now() + 3000
      if (cellSize.value > 0) {
        floatTexts.push({
          x: head.x * cellSize.value + cellSize.value / 2,
          y: head.y * cellSize.value,
          text: '👻 虛化！',
          alpha: 1,
          vy: -2,
        })
      }
      return
    }
    if (shields.value > 0) {
      shields.value--
      triggerShieldEffect()
      const safeDir = findSafeDirection(head, direction.value)
      if (safeDir) {
        direction.value = safeDir
        nextDirection.value = safeDir
      } else {
        const opposites: Record<Direction, Direction> = {
          UP: 'DOWN', DOWN: 'UP', LEFT: 'RIGHT', RIGHT: 'LEFT'
        }
        direction.value = opposites[direction.value]
        nextDirection.value = direction.value
      }
      return
    }
    deadByWall = isWall
    if (auth.currentUser) {
      scoreStore.saveScore(auth.currentUser.uid, auth.currentUser.displayName || '玩家', score.value)
    }
    gameStatus.value = 'gameover'
    return
  }

  snake.value.unshift(newHead)

  const phantomIdx = phantomItems.value.findIndex(item => item.x === newHead.x && item.y === newHead.y)
  if (phantomIdx !== -1) {
    phantomItems.value.splice(phantomIdx, 1)
    phantoms.value++
    if (cellSize.value > 0) {
      floatTexts.push({
        x: newHead.x * cellSize.value + cellSize.value / 2,
        y: newHead.y * cellSize.value,
        text: '+1 👻',
        alpha: 1,
        vy: -2,
      })
    }
  }

  const shieldIdx = shieldItems.value.findIndex(item => item.x === newHead.x && item.y === newHead.y)
  if (shieldIdx !== -1) {
    shieldItems.value.splice(shieldIdx, 1)
    shields.value++
    triggerShieldGainEffect()
  }

  const dietIdx = dietItems.value.findIndex(item => item.x === newHead.x && item.y === newHead.y)
  if (dietIdx !== -1) {
    dietItems.value.splice(dietIdx, 1)
    dietHeadEndTime = performance.now() + 3000
    const halfLen = Math.max(2, Math.ceil(snake.value.length / 2))
    snake.value = snake.value.slice(0, halfLen)
    if (cellSize.value > 0 && snake.value[0]) {
      floatTexts.push({
        x: snake.value[0].x * cellSize.value + cellSize.value / 2,
        y: snake.value[0].y * cellSize.value,
        text: '💊 減半！',
        alpha: 1,
        vy: -2,
      })
    }
  }

  const magIdx = magnetItems.value.findIndex(item => item.x === newHead.x && item.y === newHead.y)
  if (magIdx !== -1) {
    magnetItems.value.splice(magIdx, 1)
    magnetActive = true
    magnetEndTime = performance.now() + 5000
    if (cellSize.value > 0 && snake.value[0]) {
      floatTexts.push({
        x: snake.value[0].x * cellSize.value + cellSize.value / 2,
        y: snake.value[0].y * cellSize.value,
        text: '🧲 磁鐵！',
        alpha: 1,
        vy: -2,
      })
    }
  }

  const eaten = foods.value.find(f => f.x === newHead.x && f.y === newHead.y)
  if (eaten) {
    const pts = eaten.type.points
    const prevScore = score.value
    score.value += pts
    growCounter += pts
    foods.value = foods.value.filter(f => f !== eaten)
    maybeSpawnFood(false)
    const maxPerType = Math.floor(score.value / 10) + SKILL_TYPES_COUNT
    if (phantomItems.value.length < maxPerType && Math.random() < 0.3) {
      spawnPhantom()
    }
    if (shieldItems.value.length < maxPerType && Math.random() < 0.2) {
      spawnShieldItem()
    }
    if (dietItems.value.length < maxPerType && Math.random() < 0.05) {
      spawnDietItem()
    }
    if (magnetItems.value.length < maxPerType && Math.random() < 0.1) {
      spawnMagnetItem()
    }
    if (Math.floor(score.value / 50) > Math.floor(prevScore / 50)) {
      shields.value++
      triggerShieldGainEffect()
    }
  }

  if (growCounter > 0) {
    growCounter--
  } else {
    snake.value.pop()
  }

  if (magnetActive) {
    const head = snake.value[0]
    if (head) {
      const inRange = (item: { x: number; y: number }) => Math.abs(item.x - head.x) <= 3 && Math.abs(item.y - head.y) <= 3

      for (let i = foods.value.length - 1; i >= 0; i--) {
        const f = foods.value[i]
        if (f && inRange(f)) {
          score.value += f.type.points
          growCounter += f.type.points
          foods.value.splice(i, 1)
          maybeSpawnFood(false)
        }
      }

      for (let i = phantomItems.value.length - 1; i >= 0; i--) {
        const item = phantomItems.value[i]
        if (item && inRange(item)) {
          phantomItems.value.splice(i, 1)
          phantoms.value++
        }
      }

      for (let i = shieldItems.value.length - 1; i >= 0; i--) {
        const item = shieldItems.value[i]
        if (item && inRange(item)) {
          shieldItems.value.splice(i, 1)
          shields.value++
          triggerShieldGainEffect()
        }
      }

      for (let i = dietItems.value.length - 1; i >= 0; i--) {
        const item = dietItems.value[i]
        if (item && inRange(item)) {
          dietItems.value.splice(i, 1)
          dietHeadEndTime = performance.now() + 3000
          const halfLen = Math.max(2, Math.ceil(snake.value.length / 2))
          snake.value = snake.value.slice(0, halfLen)
        }
      }
    }
  }
}

function checkCollision(head: { x: number; y: number }): boolean {
  if (head.x < 0 || head.x >= gridCols.value) return true
  if (head.y < 0 || head.y >= gridRows) return true
  return snake.value.some(seg => seg.x === head.x && seg.y === head.y)
}

function findSafeDirection(head: { x: number; y: number }, currentDir: Direction): Direction | null {
  const dirs: Direction[] = ['UP', 'DOWN', 'LEFT', 'RIGHT']
  const safeDirs: Direction[] = []

  for (const dir of dirs) {
    let nx = head.x
    let ny = head.y
    switch (dir) {
      case 'RIGHT': nx += 1; break
      case 'LEFT':  nx -= 1; break
      case 'UP':    ny -= 1; break
      case 'DOWN':  ny += 1; break
    }
    if (nx < 0 || nx >= gridCols.value) continue
    if (ny < 0 || ny >= gridRows) continue
    if (snake.value.some(seg => seg.x === nx && seg.y === ny)) continue
    safeDirs.push(dir)
  }

  if (safeDirs.length === 0) return null

  const opposites: Record<Direction, Direction> = {
    UP: 'DOWN', DOWN: 'UP', LEFT: 'RIGHT', RIGHT: 'LEFT'
  }
  const preferred = safeDirs.filter(d => d !== opposites[currentDir])
  if (preferred.length > 0) {
    return preferred[Math.floor(Math.random() * preferred.length)]
  }
  return safeDirs[0]
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
  phantomItems.value.forEach(item => occupied.add(`${item.x},${item.y}`))
  shieldItems.value.forEach(item => occupied.add(`${item.x},${item.y}`))
  dietItems.value.forEach(item => occupied.add(`${item.x},${item.y}`))
  magnetItems.value.forEach(item => occupied.add(`${item.x},${item.y}`))

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

function spawnPhantom() {
  const occupied = new Set(snake.value.map(s => `${s.x},${s.y}`))
  foods.value.forEach(f => occupied.add(`${f.x},${f.y}`))
  phantomItems.value.forEach(item => occupied.add(`${item.x},${item.y}`))
  shieldItems.value.forEach(item => occupied.add(`${item.x},${item.y}`))
  dietItems.value.forEach(item => occupied.add(`${item.x},${item.y}`))
  magnetItems.value.forEach(item => occupied.add(`${item.x},${item.y}`))
  const free: { x: number; y: number }[] = []
  for (let x = 0; x < gridCols.value; x++) {
    for (let y = 0; y < gridRows; y++) {
      if (!occupied.has(`${x},${y}`)) free.push({ x, y })
    }
  }
  if (free.length > 0) {
    const pos = free[Math.floor(Math.random() * free.length)]!
    phantomItems.value.push({ x: pos.x, y: pos.y, spawnTime: performance.now() })
  }
}

function spawnShieldItem() {
  const occupied = new Set(snake.value.map(s => `${s.x},${s.y}`))
  foods.value.forEach(f => occupied.add(`${f.x},${f.y}`))
  phantomItems.value.forEach(item => occupied.add(`${item.x},${item.y}`))
  shieldItems.value.forEach(item => occupied.add(`${item.x},${item.y}`))
  dietItems.value.forEach(item => occupied.add(`${item.x},${item.y}`))
  magnetItems.value.forEach(item => occupied.add(`${item.x},${item.y}`))
  const free: { x: number; y: number }[] = []
  for (let x = 0; x < gridCols.value; x++) {
    for (let y = 0; y < gridRows; y++) {
      if (!occupied.has(`${x},${y}`)) free.push({ x, y })
    }
  }
  if (free.length > 0) {
    const pos = free[Math.floor(Math.random() * free.length)]!
    shieldItems.value.push({ x: pos.x, y: pos.y, spawnTime: performance.now() })
  }
}

function spawnDietItem() {
  const occupied = new Set(snake.value.map(s => `${s.x},${s.y}`))
  foods.value.forEach(f => occupied.add(`${f.x},${f.y}`))
  phantomItems.value.forEach(item => occupied.add(`${item.x},${item.y}`))
  shieldItems.value.forEach(item => occupied.add(`${item.x},${item.y}`))
  dietItems.value.forEach(item => occupied.add(`${item.x},${item.y}`))
  magnetItems.value.forEach(item => occupied.add(`${item.x},${item.y}`))
  const free: { x: number; y: number }[] = []
  for (let x = 0; x < gridCols.value; x++) {
    for (let y = 0; y < gridRows; y++) {
      if (!occupied.has(`${x},${y}`)) free.push({ x, y })
    }
  }
  if (free.length > 0) {
    const pos = free[Math.floor(Math.random() * free.length)]!
    dietItems.value.push({ x: pos.x, y: pos.y, spawnTime: performance.now() })
  }
}

function spawnMagnetItem() {
  const occupied = new Set(snake.value.map(s => `${s.x},${s.y}`))
  foods.value.forEach(f => occupied.add(`${f.x},${f.y}`))
  phantomItems.value.forEach(item => occupied.add(`${item.x},${item.y}`))
  shieldItems.value.forEach(item => occupied.add(`${item.x},${item.y}`))
  dietItems.value.forEach(item => occupied.add(`${item.x},${item.y}`))
  magnetItems.value.forEach(item => occupied.add(`${item.x},${item.y}`))
  const free: { x: number; y: number }[] = []
  for (let x = 0; x < gridCols.value; x++) {
    for (let y = 0; y < gridRows; y++) {
      if (!occupied.has(`${x},${y}`)) free.push({ x, y })
    }
  }
  if (free.length > 0) {
    const pos = free[Math.floor(Math.random() * free.length)]!
    magnetItems.value.push({ x: pos.x, y: pos.y, spawnTime: performance.now() })
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

function render(progress = 1) {
  const c = canvas.value
  if (!c) return
  const ctx = c.getContext('2d')
  if (!ctx) return
  const size = cellSize.value
  if (size === 0) return
  const w = window.innerWidth
  const h = window.innerHeight

  const smoothSnake = snake.value.map((seg, i) => {
    const prev = prevSnake[i]
    if (!prev) return { x: seg.x, y: seg.y }
    return {
      x: prev.x + (seg.x - prev.x) * progress,
      y: prev.y + (seg.y - prev.y) * progress,
    }
  })

  ctx.fillStyle = '#1a1a2e'
  ctx.fillRect(0, 0, w, h)

  drawGridLines(ctx, size)
  drawPhantomItem(ctx, size)
  drawShieldItem(ctx, size)
  drawDietItem(ctx, size)
  drawMagnetItem(ctx, size)
  drawFood(ctx, size)
  drawSnake(ctx, size, smoothSnake)
  drawMagnetEffect(ctx, size)
  drawShieldGainEffect(ctx, size)
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

function triggerShieldGainEffect() {
  shieldGainGlow = 30
  shieldGainFlashAlpha = 0.4
  const head = snake.value[0]
  if (!head || cellSize.value <= 0) return
  const cx = head.x * cellSize.value + cellSize.value / 2
  const cy = head.y * cellSize.value + cellSize.value / 2
  shieldGainTexts.push({
    x: cx, y: cy - 4,
    text: '🛡️ +1',
    alpha: 1, vy: -1.2, vx: 0,
    color: '#ffd700',
  })
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI * 2 / 6) * i + Math.random() * 0.5
    shieldGainTexts.push({
      x: cx, y: cy,
      text: '✦',
      alpha: 1,
      vy: -0.5 - Math.random() * 1.5,
      vx: Math.cos(angle) * (0.3 + Math.random() * 0.5),
      color: Math.random() > 0.5 ? '#ffd700' : '#ffec80',
    })
  }
}

function drawShieldGainEffect(ctx: CanvasRenderingContext2D, size: number) {
  if (shieldGainFlashAlpha > 0) {
    ctx.fillStyle = `rgba(255, 215, 0, ${shieldGainFlashAlpha})`
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight)
    shieldGainFlashAlpha -= 0.03
  }

  if (shieldGainGlow > 0) {
    ctx.save()
    ctx.shadowColor = '#ffd700'
    ctx.shadowBlur = 18
    snake.value.forEach(seg => {
      ctx.strokeStyle = 'rgba(255, 215, 0, 0.7)'
      ctx.lineWidth = 3
      ctx.strokeRect(seg.x * size, seg.y * size, size, size)
    })
    ctx.restore()
  }

  for (let i = shieldGainTexts.length - 1; i >= 0; i--) {
    const st = shieldGainTexts[i]!
    st.x += st.vx
    st.y += st.vy
    st.alpha -= 0.018
    if (st.alpha <= 0) {
      shieldGainTexts.splice(i, 1)
      continue
    }
    ctx.globalAlpha = st.alpha
    ctx.font = `bold ${size * 0.75}px sans-serif`
    ctx.textAlign = 'center'
    ctx.fillStyle = st.color
    ctx.strokeStyle = '#b8860b'
    ctx.lineWidth = 2
    ctx.strokeText(st.text, st.x, st.y)
    ctx.fillText(st.text, st.x, st.y)
    ctx.globalAlpha = 1
  }

  if (shieldGainGlow <= 0) return
  const head = snake.value[0]
  if (!head) return
  const cx = head.x * size + size / 2
  const cy = head.y * size + size / 2
  const progress = 1 - shieldGainGlow / 30
  const alpha = 1 - progress
  const r1 = size * 0.5 + progress * size * 1.5
  const r2 = size * 0.3 + progress * size * 2.2
  ctx.beginPath()
  ctx.arc(cx, cy, r1, 0, Math.PI * 2)
  ctx.strokeStyle = `rgba(255, 215, 0, ${alpha})`
  ctx.lineWidth = 3
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx, cy, r2, 0, Math.PI * 2)
  ctx.strokeStyle = `rgba(255, 236, 128, ${alpha * 0.6})`
  ctx.lineWidth = 2
  ctx.stroke()
  shieldGainGlow--
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

function drawPhantomItem(ctx: CanvasRenderingContext2D, size: number) {
  phantomAnim++
  phantomItems.value.forEach(item => {
    const elapsed = performance.now() - item.spawnTime

    let blink = 1
    if (elapsed >= 7000) {
      const t = (elapsed - 7000) / 3000
      const freq = 0.3 + t * 0.4
      blink = Math.sin(phantomAnim * freq) > 0 ? 1 : 0.2
    } else if (elapsed >= 6000) {
      blink = Math.sin(phantomAnim * 0.3) > 0 ? 1 : 0.2
    } else if (elapsed >= 3000) {
      blink = Math.sin(phantomAnim * 0.2) > 0 ? 1 : 0.2
    }

    const pulse = 0.6 + 0.4 * Math.sin(phantomAnim * 0.08)
    const cx = item.x * size + size / 2
    const cy = item.y * size + size / 2
    ctx.save()
    let fadeAlpha = 1
    if (elapsed >= 7000) {
      fadeAlpha = 1 - (1 - 0.35 / 0.65) * Math.min((elapsed - 7000) / 3000, 1)
    }
    ctx.globalAlpha = 0.65 * pulse * blink * fadeAlpha
    ctx.shadowColor = '#aa88ff'
    ctx.shadowBlur = 20
    ctx.fillStyle = '#9955ee'
    ctx.beginPath()
    ctx.arc(cx, cy, size * 0.4, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.font = `${size * 0.6}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowBlur = 0
    ctx.fillText('👻', cx, cy)
    ctx.restore()
  })
}

function drawShieldItem(ctx: CanvasRenderingContext2D, size: number) {
  shieldItemAnim++
  shieldItems.value.forEach(item => {
    const elapsed = performance.now() - item.spawnTime

    let blink = 1
    if (elapsed >= 7000) {
      const t = (elapsed - 7000) / 3000
      const freq = 0.3 + t * 0.4
      blink = Math.sin(shieldItemAnim * freq) > 0 ? 1 : 0.2
    } else if (elapsed >= 6000) {
      blink = Math.sin(shieldItemAnim * 0.3) > 0 ? 1 : 0.2
    } else if (elapsed >= 3000) {
      blink = Math.sin(shieldItemAnim * 0.2) > 0 ? 1 : 0.2
    }

    const pulse = 0.6 + 0.4 * Math.sin(shieldItemAnim * 0.08)
    const cx = item.x * size + size / 2
    const cy = item.y * size + size / 2
    ctx.save()
    let fadeAlpha = 1
    if (elapsed >= 7000) {
      fadeAlpha = 1 - (1 - 0.35 / 0.65) * Math.min((elapsed - 7000) / 3000, 1)
    }
    ctx.globalAlpha = 0.65 * pulse * blink * fadeAlpha
    ctx.shadowColor = '#ffd700'
    ctx.shadowBlur = 20
    ctx.fillStyle = '#ffaa00'
    ctx.beginPath()
    ctx.arc(cx, cy, size * 0.4, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.font = `${size * 0.6}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowBlur = 0
    ctx.fillText('🛡️', cx, cy)
    ctx.restore()
  })
}

function drawDietItem(ctx: CanvasRenderingContext2D, size: number) {
  dietItemAnim++
  dietItems.value.forEach(item => {
    const elapsed = performance.now() - item.spawnTime

    let blink = 1
    if (elapsed >= 7000) {
      const t = (elapsed - 7000) / 3000
      const freq = 0.3 + t * 0.4
      blink = Math.sin(dietItemAnim * freq) > 0 ? 1 : 0.2
    } else if (elapsed >= 6000) {
      blink = Math.sin(dietItemAnim * 0.3) > 0 ? 1 : 0.2
    } else if (elapsed >= 3000) {
      blink = Math.sin(dietItemAnim * 0.2) > 0 ? 1 : 0.2
    }

    const pulse = 0.6 + 0.4 * Math.sin(dietItemAnim * 0.08)
    const cx = item.x * size + size / 2
    const cy = item.y * size + size / 2
    ctx.save()
    let fadeAlpha = 1
    if (elapsed >= 7000) {
      fadeAlpha = 1 - (1 - 0.35 / 0.65) * Math.min((elapsed - 7000) / 3000, 1)
    }
    ctx.globalAlpha = 0.65 * pulse * blink * fadeAlpha
    ctx.shadowColor = '#44cc88'
    ctx.shadowBlur = 20
    ctx.fillStyle = '#44cc88'
    ctx.beginPath()
    ctx.arc(cx, cy, size * 0.4, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.font = `${size * 0.6}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowBlur = 0
    ctx.fillText('💊', cx, cy)
    ctx.restore()
  })
}

function drawMagnetItem(ctx: CanvasRenderingContext2D, size: number) {
  magnetAnim++
  magnetItems.value.forEach(item => {
    const elapsed = performance.now() - item.spawnTime

    let blink = 1
    if (elapsed >= 7000) {
      const t = (elapsed - 7000) / 3000
      const freq = 0.3 + t * 0.4
      blink = Math.sin(magnetAnim * freq) > 0 ? 1 : 0.2
    } else if (elapsed >= 6000) {
      blink = Math.sin(magnetAnim * 0.3) > 0 ? 1 : 0.2
    } else if (elapsed >= 3000) {
      blink = Math.sin(magnetAnim * 0.2) > 0 ? 1 : 0.2
    }

    const pulse = 0.6 + 0.4 * Math.sin(magnetAnim * 0.08)
    const cx = item.x * size + size / 2
    const cy = item.y * size + size / 2
    ctx.save()
    let fadeAlpha = 1
    if (elapsed >= 7000) {
      fadeAlpha = 1 - (1 - 0.35 / 0.65) * Math.min((elapsed - 7000) / 3000, 1)
    }
    ctx.globalAlpha = 0.65 * pulse * blink * fadeAlpha
    ctx.shadowColor = '#4488ff'
    ctx.shadowBlur = 20
    ctx.fillStyle = '#4488ff'
    ctx.beginPath()
    ctx.arc(cx, cy, size * 0.4, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.font = `${size * 0.6}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowBlur = 0
    ctx.fillText('🧲', cx, cy)
    ctx.restore()
  })
}

function drawMagnetEffect(ctx: CanvasRenderingContext2D, size: number) {
  if (!magnetActive) return
  magnetAnim++
  const head = snake.value[0]
  if (!head) return

  const cx = head.x * size + size / 2
  const cy = head.y * size + size / 2
  const range = 3 * size

  ctx.save()

  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, range)
  grad.addColorStop(0, 'rgba(68, 136, 255, 0.25)')
  grad.addColorStop(0.4, 'rgba(68, 136, 255, 0.12)')
  grad.addColorStop(1, 'rgba(68, 136, 255, 0)')
  ctx.fillStyle = grad
  ctx.fillRect(cx - range, cy - range, range * 2, range * 2)

  ctx.shadowColor = '#4488ff'
  ctx.shadowBlur = 18

  const a1 = magnetAnim * 0.025
  const a2 = magnetAnim * 0.035 + 2
  const pulse1 = 0.55 + 0.25 * Math.sin(magnetAnim * 0.06)
  const pulse2 = 0.45 + 0.2 * Math.sin(magnetAnim * 0.08 + 1.5)

  ctx.strokeStyle = `rgba(100, 180, 255, ${pulse1})`
  ctx.lineWidth = 2.5
  ctx.beginPath()
  ctx.arc(cx, cy, range, a1, a1 + Math.PI * 1.3)
  ctx.stroke()

  ctx.strokeStyle = `rgba(150, 210, 255, ${pulse2})`
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(cx, cy, range * 0.75, a2, a2 + Math.PI * 1.1)
  ctx.stroke()

  ctx.shadowBlur = 0

  for (let i = 0; i < 8; i++) {
    const angle = (Math.PI * 2 / 8) * i + magnetAnim * 0.025
    const drift = 0.5 + 0.5 * Math.sin(magnetAnim * 0.04 + i * 1.2)
    const dist = range * (0.2 + 0.6 * drift)
    const px = cx + Math.cos(angle) * dist
    const py = cy + Math.sin(angle) * dist
    const pa = 0.25 + 0.4 * Math.sin(magnetAnim * 0.12 + i * 1.8)
    ctx.beginPath()
    ctx.arc(px, py, 1.5 + Math.sin(magnetAnim * 0.1 + i * 2) * 1.2, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(140, 200, 255, ${pa})`
    ctx.fill()
  }

  ctx.restore()
}

function drawSnake(ctx: CanvasRenderingContext2D, size: number, smoothSnake: { x: number; y: number }[]) {
  if (snakeGlowTimer > 0) {
    ctx.save()
    ctx.shadowColor = '#0088ff'
    ctx.shadowBlur = 12
    smoothSnake.forEach(seg => {
      ctx.strokeStyle = 'rgba(0, 150, 255, 0.6)'
      ctx.lineWidth = 2
      ctx.strokeRect(seg.x * size, seg.y * size, size, size)
    })
    ctx.restore()
    snakeGlowTimer--
  }

  const isPhantom = phantomActive.value
  const headAngle: Record<Direction, number> = {
    RIGHT: 0,
    DOWN: Math.PI / 2,
    LEFT: Math.PI,
    UP: -Math.PI / 2,
  }

  smoothSnake.forEach((seg, i) => {
    if (isPhantom) {
      ctx.save()
      ctx.shadowColor = '#aa88ff'
      ctx.shadowBlur = 16
      ctx.globalAlpha = 0.45
      ctx.fillStyle = '#9977dd'
      ctx.fillRect(seg.x * size + 1, seg.y * size + 1, size - 2, size - 2)
      ctx.strokeStyle = 'rgba(170, 136, 255, 0.7)'
      ctx.lineWidth = 2
      ctx.strokeRect(seg.x * size, seg.y * size, size, size)
      ctx.restore()
    } else {
      let head: CanvasImageSource | null = null
      if (i === 0) {
        const isDietHead = dietHeadEndTime > 0 && performance.now() < dietHeadEndTime
        head = isDietHead || (deadByWall && gameStatus.value === 'gameover') ? deadHeadImg : (headToggle ? headImg2 : headImg)
      }
      const img = head ?? bodyImg
      if (img.complete && img.naturalWidth > 0) {
        ctx.save()
        const cx = seg.x * size + size / 2
        const cy = seg.y * size + size / 2
        ctx.translate(cx, cy)
        if (head) ctx.rotate(headAngle[direction.value])
        ctx.drawImage(img, -size / 2, -size / 2, size, size)
        ctx.restore()
      } else {
        ctx.fillStyle = i === 0 ? '#4caf50' : '#388e3c'
        ctx.fillRect(seg.x * size + 1, seg.y * size + 1, size - 2, size - 2)
      }
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
  gridCols.value = Math.floor(w / size) + (isMobile.value ? 0 : 1)

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
      <div class="score-bar">分數：<strong>{{ score }}</strong>　🛡️ {{ shields }}　👻 {{ phantoms }}</div>
      <button class="pause-btn pause-btn-desktop" @click="togglePause">
        {{ gameStatus === 'playing' ? '⏸' : '▶' }}
      </button>
      <button class="fs-btn" @click="toggleFullscreen">{{ isFullscreen ? '⤓' : '⛶' }}</button>

      <div class="overlay" v-if="gameStatus !== 'playing'">
        <div class="overlay-content">
          <template v-if="gameStatus === 'idle'">
            <div class="idle-lb-card" v-if="scoreStore.leaderboard.length > 0">
              <h1>🏆 排行榜</h1>
              <div class="idle-lb-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>玩家</th>
                      <th>最高分</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(entry, i) in scoreStore.leaderboard" :key="entry.id"
                        :class="{ me: entry.id === auth.currentUser?.uid }">
                      <td>{{ i + 1 }}</td>
                      <td>{{ entry.username }}</td>
                      <td>{{ entry.highScore }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <p>🐍 準備開始</p>
            <button class="btn" @click="startGame()">開始遊戲</button>
          </template>
          <template v-else-if="gameStatus === 'paused'">
            <p>⏸️ 已暫停</p>
            <button class="btn" @click="togglePause()">繼續</button>
          </template>
          <template v-else-if="gameStatus === 'gameover'">
            <div class="idle-lb-card" v-if="scoreStore.leaderboard.length > 0">
              <h1>🏆 排行榜</h1>
              <div class="idle-lb-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>玩家</th>
                      <th>最高分</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(entry, i) in scoreStore.leaderboard" :key="entry.id"
                        :class="{ me: entry.id === auth.currentUser?.uid }">
                      <td>{{ i + 1 }}</td>
                      <td>{{ entry.username }}</td>
                      <td>{{ entry.highScore }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
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
      <div class="score-bar score-bar-mobile">分數：<strong>{{ score }}</strong>　🛡️ {{ shields }}　👻 {{ phantoms }}</div>

      <button class="pause-btn" @click="togglePause">
        {{ gameStatus === 'playing' ? '⏸' : '▶' }}
      </button>
      <button class="fs-btn" @click="toggleFullscreen">{{ isFullscreen ? '⤓' : '⛶' }}</button>

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
            <div class="idle-lb-card" v-if="scoreStore.leaderboard.length > 0">
              <h1>🏆 排行榜</h1>
              <div class="idle-lb-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>玩家</th>
                      <th>最高分</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(entry, i) in scoreStore.leaderboard" :key="entry.id"
                        :class="{ me: entry.id === auth.currentUser?.uid }">
                      <td>{{ i + 1 }}</td>
                      <td>{{ entry.username }}</td>
                      <td>{{ entry.highScore }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <p>🐍 準備開始</p>
            <button class="btn" @click="startGame()">開始遊戲</button>
          </template>
          <template v-else-if="gameStatus === 'paused'">
            <p>⏸️ 已暫停</p>
            <button class="btn" @click="togglePause()">繼續</button>
          </template>
          <template v-else-if="gameStatus === 'gameover'">
            <div class="idle-lb-card" v-if="scoreStore.leaderboard.length > 0">
              <h1>🏆 排行榜</h1>
              <div class="idle-lb-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>玩家</th>
                      <th>最高分</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(entry, i) in scoreStore.leaderboard" :key="entry.id"
                        :class="{ me: entry.id === auth.currentUser?.uid }">
                      <td>{{ i + 1 }}</td>
                      <td>{{ entry.username }}</td>
                      <td>{{ entry.highScore }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
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

.fs-btn {
  position: absolute;
  top: calc(12px + env(safe-area-inset-top, 0px));
  right: calc(68px + env(safe-area-inset-right, 0px));
  width: 48px;
  height: 48px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.35);
  color: #fff;
  font-size: 20px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(4px);
  z-index: 2;
  transition: background 0.1s;
}

.fs-btn:active {
  background: rgba(255, 255, 255, 0.2);
}

.joystick {
  position: absolute;
  bottom: calc(24px + env(safe-area-inset-bottom, 0px));
  left: calc(24px + env(safe-area-inset-left, 0px));
  z-index: 2;
  width: 160px;
  height: 160px;
  transform: scale(0.75);
  transform-origin: bottom left;
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

.idle-lb-card {
  background: #16213e;
  padding: 20px 24px;
  border-radius: 16px;
  width: 340px;
  max-width: 85vw;
  text-align: center;
  color: #fff;
  margin-bottom: 16px;
}
.idle-lb-card h1 {
  margin: 0 0 12px;
  font-size: 22px;
}
.idle-lb-table-wrap {
  max-height: 220px;
  overflow-y: auto;
}
.idle-lb-card table {
  width: 100%;
  border-collapse: collapse;
}
.idle-lb-card th {
  font-size: 13px;
  opacity: 0.6;
  padding: 6px 4px;
  border-bottom: 1px solid rgba(255,255,255,0.1);
}
.idle-lb-card td {
  padding: 7px 4px;
  font-size: 14px;
  border-bottom: 1px solid rgba(255,255,255,0.05);
}
.idle-lb-card tr.me td {
  color: #4caf50;
  font-weight: 700;
}
</style>
