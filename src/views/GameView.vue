<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useAuthStore } from '../stores/auth'
import { useScoreStore } from '../stores/score'

const canvas = ref<HTMLCanvasElement>()
const joystickRef = ref<HTMLElement>()

// ---- World ----
const GRID_ROWS = 13
const cellSize = ref(0)
const worldRadius = ref(100)
const camera = ref({ x: 0, y: 0 })
const startWorldRadius = ref(100)

// ---- Snake ----
const SEGMENT_SPACING = 0.3
const INITIAL_SEGMENTS = 12
const ROTATION_SPEED = 0.07
const segments = ref<{ x: number; y: number }[]>([])
let path: { x: number; y: number }[] = []
let prevSegments: { x: number; y: number }[] = []
const direction = ref(0)
const targetDirection = ref(0)

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
const invincibleEndTime = ref(0)

const boosting = ref(false)
const moveSpeed = computed(() => boosting.value ? 15 : 8)

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

const isFullscreen = ref(false)

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    const el = document.documentElement
    if (el.requestFullscreen) el.requestFullscreen()
    else if ((el as any).webkitRequestFullscreen) (el as any).webkitRequestFullscreen()
    else if ((el as any).msRequestFullscreen) (el as any).msRequestFullscreen()
  } else {
    if (document.exitFullscreen) document.exitFullscreen()
    else if ((document as any).webkitExitFullscreen) (document as any).webkitExitFullscreen()
    else if ((document as any).msExitFullscreen) (document as any).msExitFullscreen()
  }
}

function onFullscreenChange() {
  isFullscreen.value = !!document.fullscreenElement
    || !!(document as any).webkitFullscreenElement
    || !!(document as any).msFullscreenElement
}

let animationId = 0
let growCounter = 0
let deadByWall = false
let invincibleFlashAlpha = 0
let invincibleGlowTimer = 0
let floatTexts: { x: number; y: number; text: string; alpha: number; vy: number }[] = []
const phantoms = ref(0)
const shields = ref(0)
const shieldDisplayTime = ref(0)
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
let lastFrameTime = 0
let mouseAngle = 0
const keysHeld = new Set<string>()
let useMouseControl = true

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
    new Promise<void>(r => { headImg.onload = () => r(); headImg.onerror = () => r() }),
    new Promise<void>(r => { headImg2.onload = () => r(); headImg2.onerror = () => r() }),
    new Promise<void>(r => { bodyImg.onload = () => r(); bodyImg.onerror = () => r() }),
    new Promise<void>(r => { deadHeadImg.onload = () => r(); deadHeadImg.onerror = () => r() })
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
  document.addEventListener('keyup', handleKeyup)
  document.addEventListener('fullscreenchange', onFullscreenChange)
  document.addEventListener('webkitfullscreenchange', onFullscreenChange)
  document.addEventListener('MSFullscreenChange', onFullscreenChange)
  const c = canvas.value
  if (c) {
    c.addEventListener('mousedown', onCanvasMouseDown)
    c.addEventListener('contextmenu', onCanvasContextMenu)
  }
  document.addEventListener('mouseup', onCanvasMouseUp)
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
  document.removeEventListener('keyup', handleKeyup)
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  document.removeEventListener('webkitfullscreenchange', onFullscreenChange)
  document.removeEventListener('MSFullscreenChange', onFullscreenChange)
  const c = canvas.value
  if (c) {
    c.removeEventListener('mousedown', onCanvasMouseDown)
    c.removeEventListener('contextmenu', onCanvasContextMenu)
  }
  document.removeEventListener('mouseup', onCanvasMouseUp)
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
    lastFrameTime = 0
  }
}

function updateWorldSize() {
  const w = window.innerWidth
  const h = window.innerHeight
  const size = Math.floor(Math.min(w, h) / GRID_ROWS)
  cellSize.value = size

  const screenArea = w * h
  const worldArea = screenArea * 7
  const worldRadiusPx = Math.sqrt(worldArea / Math.PI)
  worldRadius.value = worldRadiusPx / size
  startWorldRadius.value = worldRadius.value
}

function startGame() {
  if (isMobile.value && !isFullscreen.value) {
    try { toggleFullscreen() } catch (_) {}
    try { (screen as any).orientation?.lock?.('landscape').catch(() => {}) } catch (_) {}
  }
  updateWorldSize()

  const totalSegs = INITIAL_SEGMENTS
  const totalLen = totalSegs * SEGMENT_SPACING

  path = []
  for (let d = 0; d <= totalLen + 0.5; d += 0.05) {
    path.push({ x: -d, y: 0 })
  }
  path.reverse()

  segments.value = [{ x: 0, y: 0 }]
  updateBody()
  prevSegments = segments.value.map(s => ({ ...s }))
  direction.value = 0
  targetDirection.value = 0

  score.value = 0
  invincibleEndTime.value = 0
  deadByWall = false
  invincibleFlashAlpha = 0
  invincibleGlowTimer = 0
  growCounter = 0
  floatTexts = []
  phantoms.value = 0
  shields.value = 0
  shieldDisplayTime.value = 0
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
  mouseAngle = 0
  boosting.value = false
  keysHeld.clear()
  useMouseControl = true
  camera.value = { x: 0, y: 0 }
  gameStatus.value = 'playing'
  lastFrameTime = 0
  foods.value = []
  maintainFoodCount()
  cancelAnimationFrame(animationId)
  animationId = requestAnimationFrame(gameLoop)
}

function gameLoop(timestamp: number) {
  if (lastFrameTime === 0) lastFrameTime = timestamp
  const dt = Math.min(timestamp - lastFrameTime, 50)
  lastFrameTime = timestamp

  if (gameStatus.value === 'playing') {
    updateSnake(dt)
    shieldDisplayTime.value = Math.max(0, (invincibleEndTime.value - performance.now()) / 1000)
    maintainFoodCount()
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

  render()
  animationId = requestAnimationFrame(gameLoop)
}

function updateSnake(dt: number) {
  prevSegments = segments.value.map(s => ({ ...s }))
  const head = segments.value[0]
  if (!head) return

  // Keyboard rotation
  if (keysHeld.has('ArrowLeft') || keysHeld.has('a') || keysHeld.has('A')) {
    targetDirection.value -= ROTATION_SPEED * 2
    useMouseControl = false
  }
  if (keysHeld.has('ArrowRight') || keysHeld.has('d') || keysHeld.has('D')) {
    targetDirection.value += ROTATION_SPEED * 2
    useMouseControl = false
  }
  if (keysHeld.size === 0 && !jActive.value) {
    useMouseControl = true
  }

  // Mouse control
  if (useMouseControl && !isMobile.value) {
    targetDirection.value = mouseAngle
  }

  // Smoothly rotate current direction toward target
  let diff = targetDirection.value - direction.value
  while (diff > Math.PI) diff -= Math.PI * 2
  while (diff < -Math.PI) diff += Math.PI * 2
  if (Math.abs(diff) < ROTATION_SPEED) {
    direction.value = normalizeAngle(targetDirection.value)
  } else {
    direction.value += Math.sign(diff) * ROTATION_SPEED
    direction.value = normalizeAngle(direction.value)
  }

  // Move head
  const speed = moveSpeed.value
  const step = speed * dt / 1000
  head.x += Math.cos(direction.value) * step
  head.y += Math.sin(direction.value) * step

  // Boost drain
  if (boosting.value && growCounter > 0) {
    growCounter = Math.max(0, growCounter - 8 * dt / 1000)
  }

  // Add to path and update body
  path.unshift({ ...head })
  updateBody()
  checkCollisions(dt)
}

function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a
}

function updateBody() {
  const totalSegs = INITIAL_SEGMENTS + growCounter
  const newSegs: { x: number; y: number }[] = []
  let accumulated = 0
  let pathIdx = 0

  for (let i = 0; i < totalSegs; i++) {
    const targetDist = i * SEGMENT_SPACING
    while (pathIdx < path.length - 1) {
      const p0 = path[pathIdx]!
      const p1 = path[pathIdx + 1]!
      const segLen = dist(p0, p1)
      if (accumulated + segLen >= targetDist) {
        const t = segLen > 0 ? (targetDist - accumulated) / segLen : 0
        newSegs.push({
          x: p0.x + (p1.x - p0.x) * t,
          y: p0.y + (p1.y - p0.y) * t,
        })
        break
      }
      accumulated += segLen
      pathIdx++
    }
    if (pathIdx >= path.length - 1) break
  }

  if (newSegs.length > 0) {
    segments.value = newSegs
  }

  // Prune path
  const keepLen = totalSegs * SEGMENT_SPACING + SEGMENT_SPACING * 4
  let totalDist = 0
  for (let i = 1; i < path.length; i++) {
    totalDist += dist(path[i - 1]!, path[i]!)
    if (totalDist > keepLen) {
      path = path.slice(0, i + 1)
      return
    }
  }
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

function isInvincible(): boolean {
  return performance.now() < invincibleEndTime.value
}

function clampToWorld(pos: { x: number; y: number }) {
  const d = Math.hypot(pos.x, pos.y)
  if (d >= worldRadius.value) {
    const angle = Math.atan2(pos.y, pos.x)
    pos.x = Math.cos(angle) * (worldRadius.value - 0.01)
    pos.y = Math.sin(angle) * (worldRadius.value - 0.01)
  }
}

function triggerInvincible(duration: number) {
  const now = performance.now()
  if (now < invincibleEndTime.value) {
    invincibleEndTime.value = now + duration
  } else {
    invincibleEndTime.value = now + duration
    invincibleFlashAlpha = 0.4
    invincibleGlowTimer = 30
    addFloatText('🛡️ 免死金牌！')
  }
}

function checkCollisions(_dt: number) {
  const head = segments.value[0]
  if (!head) return

  // Wall collision — clamp to boundary, never die
  clampToWorld(head)

  // Self collision — pass through (no interaction)
  // (intentionally skipped)

  // Future: other player body collision — auto-escape + death check
  // (placeholder for multiplayer)

  // Collect food
  for (const f of foods.value) {
    if (dist(head, f) < 0.5) {
      const pts = f.type.points
      const prevScore = score.value
      score.value += pts
      growCounter += pts
      foods.value = foods.value.filter(f2 => f2 !== f)
      const maxPerType = Math.floor(score.value / 10) + SKILL_TYPES_COUNT
      if (phantomItems.value.length < maxPerType && Math.random() < 0.3) spawnPhantom()
      if (shieldItems.value.length < maxPerType && Math.random() < 0.2) spawnShieldItem()
      if (dietItems.value.length < maxPerType && Math.random() < 0.05) spawnDietItem()
      if (magnetItems.value.length < maxPerType && Math.random() < 0.1) spawnMagnetItem()
      if (Math.floor(score.value / 50) > Math.floor(prevScore / 50)) {
        triggerInvincible(3000)
      }
      break
    }
  }

  // Collect items
  for (const item of phantomItems.value) {
    if (dist(head, item) < 0.5) {
      phantomItems.value = phantomItems.value.filter(x => x !== item)
      phantoms.value++
      addFloatText('+1 👻')
    }
  }
  for (const item of shieldItems.value) {
    if (dist(head, item) < 0.5) {
      shieldItems.value = shieldItems.value.filter(x => x !== item)
      triggerInvincible(5000)
      shields.value++
    }
  }
  for (const item of dietItems.value) {
    if (dist(head, item) < 0.5) {
      dietItems.value = dietItems.value.filter(x => x !== item)
      dietHeadEndTime = performance.now() + 3000
      const halfLen = Math.max(2, Math.ceil((INITIAL_SEGMENTS + growCounter) / 2))
      growCounter = Math.max(0, halfLen - INITIAL_SEGMENTS)
      addFloatText('💊 減半！')
    }
  }
  for (const item of magnetItems.value) {
    if (dist(head, item) < 0.5) {
      magnetItems.value = magnetItems.value.filter(x => x !== item)
      magnetActive = true
      magnetEndTime = performance.now() + 5000
      addFloatText('🧲 磁鐵！')
    }
  }

  // Magnet effect
  if (magnetActive) {
    const inRange = (item: { x: number; y: number }) => Math.hypot(item.x - head.x, item.y - head.y) <= 3
    for (const f of foods.value) {
      if (inRange(f)) {
        score.value += f.type.points
        growCounter += f.type.points
        foods.value = foods.value.filter(x => x !== f)
      }
    }
    for (const item of phantomItems.value) {
      if (inRange(item)) {
        phantomItems.value = phantomItems.value.filter(x => x !== item)
        phantoms.value++
      }
    }
    for (const item of shieldItems.value) {
      if (inRange(item)) {
        shieldItems.value = shieldItems.value.filter(x => x !== item)
        triggerInvincible(5000)
        shields.value++
      }
    }
    for (const item of dietItems.value) {
      if (inRange(item)) {
        dietItems.value = dietItems.value.filter(x => x !== item)
        dietHeadEndTime = performance.now() + 3000
        const halfLen = Math.max(2, Math.ceil((INITIAL_SEGMENTS + growCounter) / 2))
        growCounter = Math.max(0, halfLen - INITIAL_SEGMENTS)
      }
    }
  }
}

function addFloatText(text: string) {
  const head = segments.value[0]
  if (!head || cellSize.value <= 0) return
  floatTexts.push({
    x: 0,
    y: 0,
    text,
    alpha: 1,
    vy: -2,
  })
}

function maintainFoodCount() {
  const targetCount = Math.floor(0.005 * Math.PI * worldRadius.value * worldRadius.value)
  const toSpawn = Math.max(0, targetCount - foods.value.length)
  if (toSpawn <= 0) return
  for (let i = 0; i < Math.min(toSpawn, 10); i++) {
    const pos = randomPointInCircle(worldRadius.value * 0.9)
    const type = FOOD_TYPES[Math.floor(Math.random() * FOOD_TYPES.length)]!
    foods.value.push({ x: pos.x, y: pos.y, type })
  }
}

function randomPointInCircle(r: number): { x: number; y: number } {
  const angle = Math.random() * Math.PI * 2
  const radius = Math.sqrt(Math.random()) * r
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }
}

function spawnPhantom() {
  const pos = randomPointInCircle(worldRadius.value * 0.85)
  phantomItems.value.push({ x: pos.x, y: pos.y, spawnTime: performance.now() })
}

function spawnShieldItem() {
  const pos = randomPointInCircle(worldRadius.value * 0.85)
  shieldItems.value.push({ x: pos.x, y: pos.y, spawnTime: performance.now() })
}

function spawnDietItem() {
  const pos = randomPointInCircle(worldRadius.value * 0.85)
  dietItems.value.push({ x: pos.x, y: pos.y, spawnTime: performance.now() })
}

function spawnMagnetItem() {
  const pos = randomPointInCircle(worldRadius.value * 0.85)
  magnetItems.value.push({ x: pos.x, y: pos.y, spawnTime: performance.now() })
}

// ---- Controls ----
function handleKeydown(e: KeyboardEvent) {
  if (e.key === ' ') {
    e.preventDefault()
    if (gameStatus.value === 'playing' || gameStatus.value === 'paused') togglePause()
    return
  }
  if (gameStatus.value !== 'playing' && gameStatus.value !== 'idle') return
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'a', 'A', 'd', 'D', 'w', 'W', 's', 'S'].includes(e.key)) {
    e.preventDefault()
  }
  keysHeld.add(e.key)
  if (gameStatus.value === 'idle' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'a' || e.key === 'A' || e.key === 'd' || e.key === 'D')) {
    startGame()
    return
  }
}

function handleKeyup(e: KeyboardEvent) {
  keysHeld.delete(e.key)
}

function onCanvasMouseMove(e: MouseEvent) {
  if (gameStatus.value !== 'playing') return
  const head = segments.value[0]
  if (!head) return
  const rect = canvas.value!.getBoundingClientRect()
  const mx = e.clientX - rect.left
  const my = e.clientY - rect.top
  const halfW = window.innerWidth / 2
  const halfH = window.innerHeight / 2
  const wx = (mx - halfW) / cellSize.value + camera.value.x
  const wy = (my - halfH) / cellSize.value + camera.value.y
  mouseAngle = Math.atan2(wy - head.y, wx - head.x)
}

function onCanvasMouseDown(e: MouseEvent) {
  if (e.button === 2 && gameStatus.value === 'playing') {
    boosting.value = true
    e.preventDefault()
  }
}

function onCanvasMouseUp(e: MouseEvent) {
  if (e.button === 2) boosting.value = false
}

function onCanvasContextMenu(e: MouseEvent) {
  e.preventDefault()
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
  if (dist < deadzone) return

  const angle = Math.atan2(dy, dx)
  targetDirection.value = angle
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
}

// ---- Rendering ----
function render() {
  const c = canvas.value
  if (!c) return
  const ctx = c.getContext('2d')
  if (!ctx) return
  const size = cellSize.value
  if (size === 0) return
  const w = window.innerWidth
  const h = window.innerHeight

  // Smooth camera follow
  const head = segments.value[0]
  if (head) {
    camera.value.x += (head.x - camera.value.x) * 0.08
    camera.value.y += (head.y - camera.value.y) * 0.08
  }

  // Clear to void color
  ctx.fillStyle = '#0d0d1a'
  ctx.fillRect(0, 0, w, h)

  ctx.save()
  // Camera transform: world coords → screen coords
  ctx.translate(w / 2 - camera.value.x * size, h / 2 - camera.value.y * size)

  // Draw play area circle
  const r = worldRadius.value * size
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.fillStyle = '#1a1a2e'
  ctx.fill()

  // Clip to play area
  ctx.save()
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.clip()

  // Draw world content
  drawPhantomItem(ctx, size)
  drawShieldItem(ctx, size)
  drawDietItem(ctx, size)
  drawMagnetItem(ctx, size)
  drawFood(ctx, size)
  drawMagnetEffect(ctx, size)
  drawSnake(ctx, size, segments.value)
  drawBoostEffect(ctx, size)

  ctx.restore() // remove clip

  // Draw boundary ring
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)'
  ctx.lineWidth = 2
  ctx.stroke()

  // Outer glow ring
  const grad = ctx.createRadialGradient(0, 0, r - 8, 0, 0, r + 8)
  grad.addColorStop(0, 'rgba(255, 50, 50, 0)')
  grad.addColorStop(0.5, 'rgba(255, 50, 50, 0.12)')
  grad.addColorStop(1, 'rgba(255, 50, 50, 0)')
  ctx.beginPath()
  ctx.arc(0, 0, r + 8, 0, Math.PI * 2)
  ctx.fillStyle = grad
  ctx.fill()

  ctx.restore() // camera transform

  // Screen-space effects
  drawInvincibleEffect(ctx, size)

  // Crosshair cursor hint for desktop
  if (gameStatus.value === 'playing' && !isMobile.value) {
    ctx.font = '14px sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.3)'
    ctx.textAlign = 'center'
    ctx.fillText('🖱️ 滑鼠控制方向', w / 2, h - 20)
  }
}

function drawSnake(ctx: CanvasRenderingContext2D, size: number, segs: { x: number; y: number }[]) {
  if (segs.length < 2) return
  const isPhantom = phantomActive.value
  const invincible = isInvincible()

  // Invincible golden glow
  if (invincible) {
    ctx.save()
    ctx.shadowColor = '#ffd700'
    ctx.shadowBlur = 22
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.lineWidth = size * 0.85
    ctx.globalAlpha = 0.35 + 0.15 * Math.sin(performance.now() * 0.006)
    ctx.strokeStyle = '#ffd700'
    ctx.beginPath()
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i]!
      const sx = s.x * size
      const sy = s.y * size
      if (i === 0) ctx.moveTo(sx, sy)
      else ctx.lineTo(sx, sy)
    }
    ctx.stroke()
    ctx.restore()
  }

  // Body
  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.lineWidth = size * 0.75

  if (isPhantom) {
    ctx.shadowColor = '#aa88ff'
    ctx.shadowBlur = 16
    ctx.globalAlpha = 0.45
    ctx.strokeStyle = '#9977dd'
  } else {
    ctx.strokeStyle = '#388e3c'
  }

  ctx.beginPath()
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!
    const sx = s.x * size
    const sy = s.y * size
    if (i === 0) ctx.moveTo(sx, sy)
    else ctx.lineTo(sx, sy)
  }
  ctx.stroke()

  if (!isPhantom) {
    ctx.lineWidth = size * 0.35
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)'
    ctx.beginPath()
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i]!
      const sx = s.x * size
      const sy = s.y * size
      if (i === 0) ctx.moveTo(sx, sy)
      else ctx.lineTo(sx, sy)
    }
    ctx.stroke()
  }

  ctx.restore()

  // Head
  const head = segs[0]
  if (!head) return
  const hx = head.x * size
  const hy = head.y * size

  if (isPhantom) {
    ctx.save()
    ctx.shadowColor = '#aa88ff'
    ctx.shadowBlur = 16
    ctx.globalAlpha = 0.45
    ctx.fillStyle = '#9977dd'
    ctx.beginPath()
    ctx.arc(hx, hy, size * 0.4, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  } else {
    const headAngle = direction.value
    const isDietHead = dietHeadEndTime > 0 && performance.now() < dietHeadEndTime
    const useDead = isDietHead || (deadByWall && gameStatus.value === 'gameover')
    const headSource = useDead ? deadHeadImg : (headToggle ? headImg2 : headImg)

    if (headSource.complete && headSource.naturalWidth > 0) {
      ctx.save()
      ctx.translate(hx, hy)
      ctx.rotate(headAngle)
      ctx.drawImage(headSource, -size / 2, -size / 2, size, size)
      ctx.restore()
    } else {
      ctx.fillStyle = '#4caf50'
      ctx.beginPath()
      ctx.arc(hx, hy, size * 0.4, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

function drawInvincibleEffect(ctx: CanvasRenderingContext2D, size: number) {
  // Screen flash on invincible pickup
  if (invincibleFlashAlpha > 0) {
    ctx.fillStyle = `rgba(255, 215, 0, ${invincibleFlashAlpha})`
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight)
    invincibleFlashAlpha -= 0.03
  }

  // Floating texts (screen-space)
  for (let i = floatTexts.length - 1; i >= 0; i--) {
    const ft = floatTexts[i]!
    ft.y += ft.vy
    ft.alpha -= 0.02
    if (ft.alpha <= 0) {
      floatTexts.splice(i, 1)
      continue
    }
    const head = segments.value[0]
    let sx = window.innerWidth / 2
    let sy = window.innerHeight / 3
    if (head) {
      sx = head.x * size - camera.value.x * size + window.innerWidth / 2
      sy = head.y * size - camera.value.y * size
    }
    ctx.globalAlpha = ft.alpha
    ctx.font = `bold ${size * 0.8}px sans-serif`
    ctx.textAlign = 'center'
    ctx.fillStyle = '#fff'
    ctx.strokeStyle = '#b8860b'
    ctx.lineWidth = 3
    ctx.strokeText(ft.text, sx, sy + ft.y)
    ctx.fillText(ft.text, sx, sy + ft.y)
    ctx.globalAlpha = 1
  }
}

function drawBoostEffect(ctx: CanvasRenderingContext2D, size: number) {
  if (!boosting.value || !segments.value[0]) return
  const head = segments.value[0]!
  const angle = direction.value
  const hx = head.x * size
  const hy = head.y * size
  const t = performance.now()
  ctx.save()
  ctx.globalAlpha = 0.35
  for (let i = 0; i < 6; i++) {
    const offset = Math.sin(t * 0.01 + i * 1.2) * size * 0.3
    const perp = angle + Math.PI / 2
    const px = hx + Math.cos(perp) * offset
    const py = hy + Math.sin(perp) * offset
    const len = size * (0.8 + 0.4 * Math.sin(t * 0.008 + i * 0.9))
    ctx.strokeStyle = `rgba(255, 200, 50, ${0.3 + 0.2 * Math.sin(t * 0.01 + i)})`
    ctx.lineWidth = size * 0.08
    ctx.beginPath()
    ctx.moveTo(px - Math.cos(angle) * size * 0.3, py - Math.sin(angle) * size * 0.3)
    ctx.lineTo(px - Math.cos(angle) * (size * 0.3 + len), py - Math.sin(angle) * (size * 0.3 + len))
    ctx.stroke()
  }
  ctx.restore()
}

function drawFood(ctx: CanvasRenderingContext2D, size: number) {
  foods.value.forEach(f => {
    ctx.fillStyle = f.type.color
    ctx.beginPath()
    ctx.arc(f.x * size, f.y * size, size / 2 - 2, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)'
    ctx.beginPath()
    ctx.arc(f.x * size - 3, f.y * size - 3, size / 6, 0, Math.PI * 2)
    ctx.fill()
  })
}

function drawItemBlink(ctx: CanvasRenderingContext2D, size: number, item: SkillItem, anim: number, color: string, shadow: string, emoji: string) {
  const elapsed = performance.now() - item.spawnTime
  let blink = 1
  if (elapsed >= 7000) {
    const t = (elapsed - 7000) / 3000
    const freq = 0.3 + t * 0.4
    blink = Math.sin(anim * freq) > 0 ? 1 : 0.2
  } else if (elapsed >= 6000) {
    blink = Math.sin(anim * 0.3) > 0 ? 1 : 0.2
  } else if (elapsed >= 3000) {
    blink = Math.sin(anim * 0.2) > 0 ? 1 : 0.2
  }
  const pulse = 0.6 + 0.4 * Math.sin(anim * 0.08)
  const cx = item.x * size
  const cy = item.y * size
  ctx.save()
  let fadeAlpha = 1
  if (elapsed >= 7000) {
    fadeAlpha = 1 - (1 - 0.35 / 0.65) * Math.min((elapsed - 7000) / 3000, 1)
  }
  ctx.globalAlpha = 0.65 * pulse * blink * fadeAlpha
  ctx.shadowColor = shadow
  ctx.shadowBlur = 20
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx, cy, size * 0.4, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.font = `${size * 0.6}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowBlur = 0
  ctx.fillText(emoji, cx, cy)
  ctx.restore()
}

function drawPhantomItem(ctx: CanvasRenderingContext2D, size: number) {
  phantomAnim++
  phantomItems.value.forEach(item => drawItemBlink(ctx, size, item, phantomAnim, '#9955ee', '#aa88ff', '👻'))
}

function drawShieldItem(ctx: CanvasRenderingContext2D, size: number) {
  shieldItemAnim++
  shieldItems.value.forEach(item => drawItemBlink(ctx, size, item, shieldItemAnim, '#ffaa00', '#ffd700', '🛡️'))
}

function drawDietItem(ctx: CanvasRenderingContext2D, size: number) {
  dietItemAnim++
  dietItems.value.forEach(item => drawItemBlink(ctx, size, item, dietItemAnim, '#44cc88', '#44cc88', '💊'))
}

function drawMagnetItem(ctx: CanvasRenderingContext2D, size: number) {
  magnetAnim++
  magnetItems.value.forEach(item => drawItemBlink(ctx, size, item, magnetAnim, '#4488ff', '#4488ff', '🧲'))
}

function drawMagnetEffect(ctx: CanvasRenderingContext2D, size: number) {
  if (!magnetActive) return
  magnetAnim++
  const head = segments.value[0]
  if (!head) return
  const cx = head.x * size
  const cy = head.y * size
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

function resizeCanvas() {
  const c = canvas.value
  if (!c) return
  const dpr = window.devicePixelRatio || 1
  const w = window.innerWidth
  const h = window.innerHeight

  const size = Math.floor(Math.min(w, h) / GRID_ROWS)
  cellSize.value = size
  updateWorldSize()

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
    <canvas ref="canvas" id="gameCanvas" @mousemove="onCanvasMouseMove"></canvas>

    <!-- Desktop -->
    <template v-if="!isMobile">
      <div class="score-bar">分數：<strong>{{ score }}</strong>　👻 {{ phantoms }}　<span :class="isInvincible() ? 'shield-active' : 'shield-inactive'">🛡️ {{ shields }}<template v-if="isInvincible()"> {{ shieldDisplayTime.toFixed(1) }}s</template></span></div>
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
            <p style="font-size:14px;opacity:0.5;margin:-8px 0 12px">滑鼠或 ← → 控制方向</p>
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

    <!-- 手機直立提示 -->
    <template v-else-if="!isLandscape">
      <div class="rotate-hint">
        <div class="rotate-icon">↻</div>
        <p>請旋轉手機以開始遊戲</p>
      </div>
    </template>

    <!-- 手機橫向遊戲 -->
    <template v-else>
      <div class="score-bar score-bar-mobile">分數：<strong>{{ score }}</strong>　👻 {{ phantoms }}　<span :class="isInvincible() ? 'shield-active' : 'shield-inactive'">🛡️ {{ shields }}<template v-if="isInvincible()"> {{ shieldDisplayTime.toFixed(1) }}s</template></span></div>

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
  width: 100%;
  height: 100%;
  height: 100dvh;
  overflow: hidden;
  touch-action: none;
  -ms-touch-action: none;
  -webkit-overflow-scrolling: none;
  overscroll-behavior: none;
}

#gameCanvas {
  display: block;
  background: #0d0d1a;
  touch-action: none;
  cursor: crosshair;
}

.score-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  padding: 8px 16px;
  padding-top: calc(8px + env(safe-area-inset-top, 0px));
  padding-left: calc(16px + env(safe-area-inset-left, 0px));
  padding-right: calc(16px + env(safe-area-inset-right, 0px));
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
  padding: 6px 12px;
  padding-top: calc(6px + env(safe-area-inset-top, 0px));
  padding-left: calc(12px + env(safe-area-inset-left, 0px));
  padding-right: calc(12px + env(safe-area-inset-right, 0px));
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
  top: calc(8px + env(safe-area-inset-top, 0px));
  right: calc(8px + env(safe-area-inset-right, 0px));
  width: 44px;
  height: 44px;
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

.pause-btn:active {
  background: rgba(255, 255, 255, 0.2);
}

.pause-btn-desktop:hover {
  background: rgba(255, 255, 255, 0.15);
}

.fs-btn {
  position: absolute;
  top: calc(8px + env(safe-area-inset-top, 0px));
  right: calc(60px + env(safe-area-inset-right, 0px));
  width: 44px;
  height: 44px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.35);
  color: #fff;
  font-size: 18px;
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
  bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  left: calc(12px + env(safe-area-inset-left, 0px));
  z-index: 2;
  width: 160px;
  height: 160px;
  transform: scale(0.65);
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
.shield-active { color: #ffd700; }
.shield-inactive { opacity: 0.35; }
</style>
