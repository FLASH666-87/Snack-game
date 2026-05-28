<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useAuthStore } from '../stores/auth'
import { connectSocket, disconnectSocket } from '../services/socket'
import type { Socket } from 'socket.io-client'

const canvas = ref<HTMLCanvasElement>()
const joystickRef = ref<HTMLElement>()

// ---- Multiplayer state ----
const gamePhase = ref<'lobby' | 'playing' | 'dead' | 'gameover'>('lobby')
const roomCode = ref('')
const playersInRoom = ref<PlayerInfo[]>([])
const connected = ref(false)
const myId = ref('')
const joinCodeInput = ref('')
const errorMsg = ref('')
const isHost = computed(() => playersInRoom.value.length > 0 && playersInRoom.value[0]?.id === myId.value)

interface PlayerInfo {
  id: string
  username: string
  alive: boolean
}

interface ServerPlayer {
  id: string
  username: string
  segments: { x: number; y: number }[]
  direction: number
  score: number
  shields: number
  boosting: boolean
  alive: boolean
  phantomActive: boolean
  phantomCharges: number
  phantomEndTime: number
  dietHeadEndTime: number
  magnetActive: boolean
  magnetEndTime: number
  invincibleEndTime: number
  knockbackX: number
  knockbackY: number
  laserCharges: number
  firingLaser: boolean
  laserDirection: number
  laserOriginX: number
  laserOriginY: number
}

interface ServerGameState {
  players: Record<string, ServerPlayer>
  foods: FoodItem[]
  phantomItems: SkillItem[]
  shieldItems: SkillItem[]
  dietItems: SkillItem[]
  magnetItems: SkillItem[]
  laserItems: SkillItem[]
  shockwaves: Shockwave[]
  worldRadius: number
  status: string
  tickCount: number
}

interface Shockwave {
  x: number
  y: number
  spawnTick: number
}

interface GameResult {
  id: string
  username: string
  score: number
  alive: boolean
}

const serverState = ref<ServerGameState | null>(null)
const gameResults = ref<GameResult[]>([])
const serverNow = ref(0)

function alivePlayerCount(): number {
  if (!serverState.value) return 0
  return Object.keys(serverState.value.players).filter(id => serverState.value!.players[id]?.alive).length
}

const PLAYER_COLORS = [
  { body: '#4caf50', head: '#388e3c' },
  { body: '#e53935', head: '#c62828' },
  { body: '#1e88e5', head: '#1565c0' },
  { body: '#fdd835', head: '#f9a825' },
  { body: '#8e24aa', head: '#6a1b9a' },
  { body: '#fb8c00', head: '#ef6c00' },
  { body: '#00acc1', head: '#00838f' },
  { body: '#ec407a', head: '#c2185b' },
]

function getPlayerColor(id: string): { body: string; head: string } {
  if (!serverState.value) return { body: '#4caf50', head: '#388e3c' }
  const ids = Object.keys(serverState.value.players)
  const idx = ids.indexOf(id)
  return PLAYER_COLORS[Math.max(0, idx) % PLAYER_COLORS.length]!
}

function playerColor(i: number): string {
  return PLAYER_COLORS[i % PLAYER_COLORS.length]!.body
}

// ---- World ----
const GRID_ROWS = 13
const cellSize = ref(0)
const worldRadius = ref(100)
const camera = ref({ x: 0, y: 0 })

// ---- Snake (local player only for effects) ----
const segments = ref<{ x: number; y: number }[]>([])
const direction = ref(0)

interface FoodType { color: string; points: number }
interface FoodItem { x: number; y: number; type: FoodType }
interface SkillItem { x: number; y: number; spawnTime: number; spawnTick?: number }

const auth = useAuthStore()

const score = ref(0)
const boosting = ref(false)

const isMobile = ref(false)
const isLandscape = ref(true)

const jOffsetX = ref(0)
const jOffsetY = ref(0)
const jActive = ref(false)

const isFullscreen = ref(false)

const phantomItems = ref<SkillItem[]>([])
const shieldItems = ref<SkillItem[]>([])
const dietItems = ref<SkillItem[]>([])
const magnetItems = ref<SkillItem[]>([])
const laserItems = ref<SkillItem[]>([])
let phantomAnim = 0
let shieldItemAnim = 0
let dietItemAnim = 0
let magnetAnim = 0
let laserAnim = 0
let jCenterX = 0
let jCenterY = 0
let jTouchId = -1

const J_RADIUS = 39

let mqPointer: MediaQueryList
let mqOrientation: MediaQueryList
let mouseAngle = 0
const keysHeld = new Set<string>()
let useMouseControl = true

const knobStyle = computed(() => ({
  transform: `translate(${jOffsetX.value}px, ${jOffsetY.value}px)`
}))

function onFullscreenChange() {
  const doc = document as Document & { webkitFullscreenElement?: Element; msFullscreenElement?: Element }
  isFullscreen.value = !!doc.fullscreenElement || !!doc.webkitFullscreenElement || !!doc.msFullscreenElement
}

let animationId = 0
let floatTexts: { x: number; y: number; text: string; alpha: number; vy: number }[] = []

// ---- Lerp ----
let lerpTarget: { x: number; y: number }[] = []
const LERP_SPEED = 0.35

// ---- Keyboard accumulation ----
let localTargetDirection = 0
const KEYBOARD_ROTATION_SPEED = 0.75

// ---- Head images ----
const headImg = new Image()
const headImg2 = new Image()
const deadHeadImg = new Image()
let headSwapTimer = 0
let headToggle = false

interface BoostParticle {
  x: number; y: number
  vx: number; vy: number
  life: number; maxLife: number
  size: number; alpha: number
  color: string
}
const boostParticles: BoostParticle[] = []
const phantoms = ref(0)
const shields = ref(0)
const laserCharges = ref(0)

interface CollisionParticle {
  x: number; y: number
  vx: number; vy: number
  life: number; maxLife: number
  size: number
  color: string
}
const collisionParticles: CollisionParticle[] = []
const processedShockwaves = new Set<number>()

interface LaserFlash { originX: number; originY: number; direction: number; time: number }
const laserFlashes: LaserFlash[] = []

const phantomActive = ref(false)
const phantomEndTime = ref(0)
const magnetEndTime = ref(0)

const magnetTimeLeft = computed(() => {
  if (magnetEndTime.value <= 0) return 0
  const remaining = Math.ceil((magnetEndTime.value - serverNow.value) / 1000)
  return Math.max(0, remaining)
})
const phantomTimeLeft = computed(() => {
  if (phantomEndTime.value <= 0) return 0
  const remaining = Math.ceil((phantomEndTime.value - serverNow.value) / 1000)
  return Math.max(0, remaining)
})

let socket: Socket | null = null

function connectServer() {
  socket = connectSocket()

  socket.on('connect', () => {
    connected.value = true
    myId.value = socket!.id!
    errorMsg.value = ''
  })

  socket.on('connect_error', (err: Error) => {
    connected.value = false
    if (gamePhase.value === 'lobby') {
      errorMsg.value = `無法連線到遊戲伺服器（${err.message}）`
    }
  })

  socket.on('disconnect', () => {
    connected.value = false
    if (gamePhase.value !== 'lobby') {
      gamePhase.value = 'lobby'
      errorMsg.value = '與伺服器斷線'
    }
  })

  socket.on('room_created', ({ roomCode: code }: { roomCode: string }) => {
    roomCode.value = code
    errorMsg.value = ''
  })

  socket.on('room_state', (state: { roomCode: string; players: PlayerInfo[]; status: string }) => {
    playersInRoom.value = state.players
    roomCode.value = state.roomCode
    if (state.status === 'waiting' && gamePhase.value === 'gameover') {
      gamePhase.value = 'lobby'
      gameResults.value = []
      serverState.value = null
    }
  })

  socket.on('game_started', () => {
    gamePhase.value = 'playing'
    resetLocalState()
  })

  socket.on('game_state', (state: ServerGameState) => {
    serverState.value = state
    worldRadius.value = state.worldRadius
    serverNow.value = state.tickCount * 50

    // Update local player refs for rendering
    const me = state.players[myId.value]
    if (me) {
      // Detect own death
      if (!me.alive && gamePhase.value === 'playing') {
        gamePhase.value = 'dead'
      }
      // Detect respawn
      if (me.alive && gamePhase.value === 'dead') {
        gamePhase.value = 'playing'
        resetLocalState()
      }
      lerpTarget = me.segments.map(s => ({ x: s.x, y: s.y }))
      if (segments.value.length === 0 || me.segments.length !== segments.value.length) {
        segments.value = lerpTarget.map(s => ({ ...s }))
      }
      direction.value = me.direction
      localTargetDirection = me.direction
      score.value = me.score
      shields.value = me.shields
      boosting.value = me.boosting
      phantomActive.value = me.phantomActive
      phantomEndTime.value = me.phantomEndTime
      phantoms.value = me.phantomCharges
      magnetEndTime.value = me.magnetEndTime
      laserCharges.value = me.laserCharges
    }

    // Track laser flashes for visual
    for (const [, p] of Object.entries(state.players)) {
      if (p.firingLaser && p.alive) {
        laserFlashes.push({ originX: p.laserOriginX, originY: p.laserOriginY, direction: p.laserDirection, time: performance.now() })
      }
    }

    // Sync items
    phantomItems.value = state.phantomItems.map(i => ({ x: i.x, y: i.y, spawnTick: i.spawnTick, spawnTime: performance.now() - (serverNow.value - (i.spawnTick ?? 0) * 50) }))
    shieldItems.value = state.shieldItems.map(i => ({ x: i.x, y: i.y, spawnTick: i.spawnTick, spawnTime: performance.now() - (serverNow.value - (i.spawnTick ?? 0) * 50) }))
    dietItems.value = state.dietItems.map(i => ({ x: i.x, y: i.y, spawnTick: i.spawnTick, spawnTime: performance.now() - (serverNow.value - (i.spawnTick ?? 0) * 50) }))
    magnetItems.value = state.magnetItems.map(i => ({ x: i.x, y: i.y, spawnTick: i.spawnTick, spawnTime: performance.now() - (serverNow.value - (i.spawnTick ?? 0) * 50) }))
    laserItems.value = state.laserItems.map(i => ({ x: i.x, y: i.y, spawnTick: i.spawnTick, spawnTime: performance.now() - (serverNow.value - (i.spawnTick ?? 0) * 50) }))
  })

  socket.on('game_over', (results: GameResult[]) => {
    gamePhase.value = 'gameover'
    gameResults.value = results
  })

  socket.on('error', (msg: string) => {
    errorMsg.value = msg
  })
}

function resetLocalState() {
  score.value = 0
  shields.value = 0
  phantoms.value = 0
  phantomActive.value = false
  boosting.value = false
  keysHeld.clear()
  useMouseControl = true
  camera.value = { x: 0, y: 0 }
  segments.value = []
  floatTexts = []
  boostParticles.length = 0
  collisionParticles.length = 0
  processedShockwaves.clear()
  laserFlashes.length = 0
  laserCharges.value = 0
  mouseAngle = 0
  headSwapTimer = 0
  headToggle = false
  lerpTarget = []
  localTargetDirection = 0
}

// ---- Lobby ----
function createRoom() {
  if (!connected.value || !socket) return
  const username = auth.currentUser?.displayName || '玩家'
  errorMsg.value = ''
  socket.emit('create_room', { username })
}

function joinRoom() {
  if (!connected.value || !socket) return
  const code = joinCodeInput.value.trim().toUpperCase()
  if (!code) return
  const username = auth.currentUser?.displayName || '玩家'
  errorMsg.value = ''
  socket.emit('join_room', { roomCode: code, username })
}

function startGame() {
  if (!connected.value || !socket) return
  errorMsg.value = ''
  socket.emit('start_game')
}

function leaveRoom() {
  if (!connected.value || !socket) return
  socket.emit('leave_room')
  roomCode.value = ''
  playersInRoom.value = []
  gamePhase.value = 'lobby'
  errorMsg.value = ''
}

function restartGame() {
  if (!connected.value || !socket) return
  errorMsg.value = ''
  socket.emit('restart_game')
}

function backToLobby() {
  if (!connected.value || !socket) return
  socket.emit('leave_room')
  gamePhase.value = 'lobby'
  gameResults.value = []
  serverState.value = null
  roomCode.value = ''
  playersInRoom.value = []
}

function returnToGame() {
  if (!socket) return
  socket.emit('respawn')
}

// ---- Controls ----
function sendInput(input: { targetDirection?: number; boosting?: boolean }) {
  if (!socket || gamePhase.value !== 'playing') return
  socket.emit('player_input', input)
}

function activatePhantomSkill() {
  socket?.emit('activate_phantom')
}

function fireLaserSkill() {
  socket?.emit('activate_laser')
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === ' ') {
    e.preventDefault()
    return
  }
  if (gamePhase.value !== 'playing' && gamePhase.value !== 'lobby') return
  if (['ArrowLeft', 'ArrowRight', 'a', 'A', 'd', 'D'].includes(e.key)) {
    e.preventDefault()
    if (keysHeld.size === 0) {
      localTargetDirection = direction.value
    }
    keysHeld.add(e.key)
    useMouseControl = false
    if (gamePhase.value === 'lobby') return
    if (keysHeld.has('ArrowLeft') || keysHeld.has('a') || keysHeld.has('A')) {
      localTargetDirection -= KEYBOARD_ROTATION_SPEED
    }
    if (keysHeld.has('ArrowRight') || keysHeld.has('d') || keysHeld.has('D')) {
      localTargetDirection += KEYBOARD_ROTATION_SPEED
    }
    sendInput({ targetDirection: localTargetDirection })
  }
  if (e.key === 'w' || e.key === 'W') {
    sendInput({ boosting: true })
  }
  if (e.key === '1') {
    activatePhantomSkill()
  }
  if (e.key === '2') {
    fireLaserSkill()
  }
}

function handleKeyup(e: KeyboardEvent) {
  keysHeld.delete(e.key)
  if (e.key === 'w' || e.key === 'W') {
    sendInput({ boosting: false })
  }
  if (keysHeld.size === 0 && !jActive.value) {
    useMouseControl = true
  }
}

function onCanvasMouseMove(e: MouseEvent) {
  if (gamePhase.value !== 'playing') return
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
  if (useMouseControl) {
    sendInput({ targetDirection: mouseAngle })
  }
}

function onCanvasMouseDown(e: MouseEvent) {
  if (e.button === 2 && gamePhase.value === 'playing') {
    sendInput({ boosting: true })
    e.preventDefault()
  }
}

function onCanvasMouseUp(e: MouseEvent) {
  if (e.button === 2) sendInput({ boosting: false })
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
  sendInput({ targetDirection: angle })
}

function onJoystickStart(e: TouchEvent) {
  if (gamePhase.value !== 'playing' || !isMobile.value || !isLandscape.value) return
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

// ---- Lifecycle ----
onMounted(() => {
  mqPointer = window.matchMedia('(pointer: coarse)')
  isMobile.value = mqPointer.matches
  mqPointer.addEventListener('change', onPointerChange)

  mqOrientation = window.matchMedia('(orientation: landscape)')
  isLandscape.value = mqOrientation.matches
  mqOrientation.addEventListener('change', onOrientationChange)

  resizeCanvas()
  window.addEventListener('resize', resizeCanvas)

  connectServer()

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

  animationId = requestAnimationFrame(renderLoop)

  // Load head images
  headImg.src = new URL('/Snack-game/img/head.jpg', window.location.origin).href
  headImg2.src = new URL('/Snack-game/img/head2.jpg', window.location.origin).href
  deadHeadImg.src = new URL('/Snack-game/img/head_dead.jpg', window.location.origin).href
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
  disconnectSocket()
})

function onPointerChange(e: MediaQueryListEvent) {
  isMobile.value = e.matches
}

function onOrientationChange(e: MediaQueryListEvent) {
  isLandscape.value = e.matches
}

// ---- Rendering loop ----
function renderLoop() {
  try {
    headSwapTimer++
    if (headSwapTimer >= 10) {
      headToggle = !headToggle
      headSwapTimer = 0
    }
    if (gamePhase.value === 'playing') {
      if (!useMouseControl && keysHeld.size > 0) {
        if (keysHeld.has('ArrowLeft') || keysHeld.has('a') || keysHeld.has('A')) {
          localTargetDirection -= KEYBOARD_ROTATION_SPEED
        }
        if (keysHeld.has('ArrowRight') || keysHeld.has('d') || keysHeld.has('D')) {
          localTargetDirection += KEYBOARD_ROTATION_SPEED
        }
        sendInput({ targetDirection: localTargetDirection })
      }
    }
    render()
  } catch (e) {
    console.error('Render error:', e)
  }
  animationId = requestAnimationFrame(renderLoop)
}

// ---- Rendering ----
// ---- Lerp ----
function applyLerp() {
  if (lerpTarget.length === 0 || segments.value.length === 0) return
  if (lerpTarget.length !== segments.value.length) {
    segments.value = lerpTarget.map(s => ({ ...s }))
    return
  }
  for (let i = 0; i < segments.value.length; i++) {
    const s = segments.value[i]
    const t = lerpTarget[i]
    if (!s || !t) continue
    s.x += (t.x - s.x) * LERP_SPEED
    s.y += (t.y - s.y) * LERP_SPEED
  }
}

function render() {
  applyLerp()
  const c = canvas.value
  if (!c) return
  const ctx = c.getContext('2d')
  if (!ctx) return
  const size = cellSize.value
  if (size === 0) return
  const w = window.innerWidth
  const h = window.innerHeight

  // Smooth camera follow on local player
  const head = segments.value[0]
  if (head) {
    camera.value.x += (head.x - camera.value.x) * 0.08
    camera.value.y += (head.y - camera.value.y) * 0.08
  }

  ctx.fillStyle = '#0d0d1a'
  ctx.fillRect(0, 0, w, h)

  ctx.save()
  ctx.translate(w / 2 - camera.value.x * size, h / 2 - camera.value.y * size)

  const r = worldRadius.value * size
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.fillStyle = '#1a1a2e'
  ctx.fill()

  ctx.save()
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.clip()

  if (serverState.value) {
    drawPhantomItem(ctx, size)
    drawShieldItem(ctx, size)
    drawDietItem(ctx, size)
    drawMagnetItem(ctx, size)
    drawLaserItem(ctx, size)
    drawLaser(ctx, size)
    drawMagnetEffect(ctx, size)
    drawFood(ctx, size)
    drawShockwave(ctx, size)

    // Draw all players
    const allPlayers = serverState.value.players
    const playerIds = Object.keys(allPlayers)
    for (const pid of playerIds) {
      const p = allPlayers[pid]
      if (!p || !p.alive || p.segments.length < 2) continue
      drawSnake(ctx, size, p)
    }

    // Local particles
    drawBoostEffect(ctx, size)
    drawCollisionParticles(ctx, size)
  }

  ctx.restore()

  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)'
  ctx.lineWidth = 2
  ctx.stroke()

  const grad = ctx.createRadialGradient(0, 0, r - 8, 0, 0, r + 8)
  grad.addColorStop(0, 'rgba(255, 50, 50, 0)')
  grad.addColorStop(0.5, 'rgba(255, 50, 50, 0.12)')
  grad.addColorStop(1, 'rgba(255, 50, 50, 0)')
  ctx.beginPath()
  ctx.arc(0, 0, r + 8, 0, Math.PI * 2)
  ctx.fillStyle = grad
  ctx.fill()

  ctx.restore()

  drawInvincibleEffect(ctx, size)

  if (gamePhase.value === 'playing' && !isMobile.value) {
    ctx.font = '14px sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.3)'
    ctx.textAlign = 'center'
    ctx.fillText('🖱️ 滑鼠控制方向', w / 2, h - 20)
  }

  // Debug info
  ctx.font = '12px monospace'
  ctx.fillStyle = 'rgba(255,255,255,0.5)'
  ctx.textAlign = 'left'
  const ss = serverState.value
  const pCount = ss ? Object.keys(ss.players).length : 0
  const segLen = segments.value.length
  ctx.fillText(`phase=${gamePhase.value} ss=${!!ss} players=${pCount} segs=${segLen} cell=${cellSize.value} wr=${worldRadius.value.toFixed(1)}`, 8, h - 8)
}

function drawSnake(ctx: CanvasRenderingContext2D, size: number, player: ServerPlayer) {
  const segs = player.id === myId.value && segments.value.length > 0 ? segments.value : player.segments
  if (!segs || segs.length < 2) return
  const color = getPlayerColor(player.id)
  const isPhantom = player.phantomActive
  const isInvincible = player.invincibleEndTime > serverNow.value && !isPhantom
  const glowPulse = isInvincible ? 0.5 + Math.sin(serverNow.value * 0.01) * 0.5 : 0

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
    ctx.strokeStyle = color!.body
  }
  if (isInvincible) {
    ctx.shadowColor = '#ffd700'
    ctx.shadowBlur = 12 + glowPulse * 33
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

  // Golden body overlay for invincible
  if (isInvincible) {
    ctx.lineWidth = size * 0.5
    ctx.strokeStyle = `rgba(255, 215, 0, ${0.15 + glowPulse * 0.2})`
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

  // Head halo (invincible)
  if (isInvincible) {
    const haloR = size * (1.0 + glowPulse * 1.0)
    const grad = ctx.createRadialGradient(hx, hy, 0, hx, hy, haloR)
    grad.addColorStop(0, `rgba(255, 215, 0, ${0.25 + glowPulse * 0.35})`)
    grad.addColorStop(1, 'rgba(255, 215, 0, 0)')
    ctx.save()
    ctx.beginPath()
    ctx.arc(hx, hy, haloR, 0, Math.PI * 2)
    ctx.fillStyle = grad
    ctx.fill()
    ctx.restore()

    // Second inner halo for extra pop
    const innerR = size * (0.5 + glowPulse * 0.3)
    const grad2 = ctx.createRadialGradient(hx, hy, 0, hx, hy, innerR)
    grad2.addColorStop(0, `rgba(255, 255, 200, ${0.3 + glowPulse * 0.4})`)
    grad2.addColorStop(1, 'rgba(255, 255, 200, 0)')
    ctx.save()
    ctx.beginPath()
    ctx.arc(hx, hy, innerR, 0, Math.PI * 2)
    ctx.fillStyle = grad2
    ctx.fill()
    ctx.restore()
  }

  // Shield orbs (multi-orbit around head when invincible)
  if (isInvincible) {
    const orbs = [
      { count: 3, speed: 0.010, radius: 0.80, size: 0.12 },
      { count: 3, speed: -0.007, radius: 1.10, size: 0.08 },
    ]
    for (const ring of orbs) {
      for (let i = 0; i < ring.count; i++) {
        const angle = (i / ring.count) * Math.PI * 2 + serverNow.value * ring.speed
        const sx = hx + Math.cos(angle) * size * ring.radius
        const sy = hy + Math.sin(angle) * size * ring.radius
        ctx.save()
        ctx.shadowColor = '#ffd700'
        ctx.shadowBlur = 14
        ctx.fillStyle = '#ffe044'
        ctx.globalAlpha = 0.5 + Math.sin(serverNow.value * 0.02 + i * 2) * 0.3
        ctx.beginPath()
        ctx.arc(sx, sy, size * ring.size, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }
    }
  }

  // Invincible pulse ring (periodic golden ripple)
  if (isInvincible) {
    const pulsePhase = (serverNow.value % 3000) / 3000
    const pR = size * (0.3 + pulsePhase * 1.2)
    const pAlpha = (1 - pulsePhase) * 0.3
    ctx.save()
    ctx.strokeStyle = `rgba(255, 215, 0, ${pAlpha})`
    ctx.lineWidth = size * 0.1
    ctx.shadowColor = '#ffd700'
    ctx.shadowBlur = 8
    ctx.beginPath()
    ctx.arc(hx, hy, pR, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }

  const isLocal = player.id === myId.value

  // Knockback trail (golden glow when being pushed back)
  const kbMag = Math.hypot(player.knockbackX || 0, player.knockbackY || 0)
  if (kbMag > 0.05) {
    ctx.save()
    ctx.lineWidth = size * 0.9
    ctx.strokeStyle = `rgba(255, 215, 0, ${Math.min(kbMag * 0.3, 0.5)})`
    ctx.shadowColor = '#ffd700'
    ctx.shadowBlur = 20 + kbMag * 30
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

    // Speed lines behind head
    ctx.save()
    const knockAngle = Math.atan2(player.knockbackY || 0, player.knockbackX || 0)
    for (let i = 0; i < 4; i++) {
      const scatter = (Math.random() - 0.5) * 0.8
      const lineAngle = knockAngle + Math.PI + scatter
      const lineLen = size * (0.3 + kbMag * 0.5)
      const offset = (Math.random() - 0.5) * size * 0.4
      const perp = knockAngle + Math.PI / 2
      const lx = hx + Math.cos(perp) * offset
      const ly = hy + Math.sin(perp) * offset
      ctx.strokeStyle = `rgba(255, 215, 0, ${Math.min(kbMag * 0.4, 0.5)})`
      ctx.lineWidth = size * 0.06
      ctx.shadowColor = '#ffd700'
      ctx.shadowBlur = 6
      ctx.beginPath()
      ctx.moveTo(lx, ly)
      ctx.lineTo(lx + Math.cos(lineAngle) * lineLen, ly + Math.sin(lineAngle) * lineLen)
      ctx.stroke()
    }
    ctx.restore()
  }

  if (isLocal && headImg.complete && headImg.naturalWidth > 0) {
    const isDiet = player.dietHeadEndTime > serverNow.value
    const img = (!player.alive || isDiet ? deadHeadImg : (headToggle ? headImg : headImg2)) || headImg
    if (img.complete && img.naturalWidth > 0) {
      ctx.save()
      if (isPhantom) {
        ctx.shadowColor = '#aa88ff'
        ctx.shadowBlur = 16
        ctx.globalAlpha = 0.45
      } else if (isInvincible) {
        ctx.shadowColor = '#ffd700'
        ctx.shadowBlur = 12 + glowPulse * 28
      }
      const hs = size * 1.2
      ctx.translate(hx, hy)
      ctx.rotate(direction.value)
      ctx.drawImage(img, -hs / 2, -hs / 2, hs, hs)
      ctx.restore()
      return
    }
  }

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
      ctx.save()
      if (isInvincible) {
        ctx.shadowColor = '#ffd700'
        ctx.shadowBlur = 12 + glowPulse * 28
      }
    ctx.fillStyle = color!.head
    ctx.beginPath()
    ctx.arc(hx, hy, size * 0.4, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
}

function drawInvincibleEffect(ctx: CanvasRenderingContext2D, size: number) {
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
  const now = performance.now()

  if (boosting.value) {
    const head = segments.value[0]
    if (head) {
      const angle = direction.value
      const count = 3 + Math.floor(Math.random() * 4)
      const BOOST_COLORS = ['#ff4500', '#ffaa00', '#ff6600', '#ff2200', '#ffcc00', '#ffffff']
      for (let i = 0; i < count; i++) {
        const scatter = (Math.random() - 0.5) * 1.0
        const emitAngle = angle + Math.PI + scatter
        const speed = 2 + Math.random() * 3
        boostParticles.push({
          x: head.x,
          y: head.y,
          vx: Math.cos(emitAngle) * speed,
          vy: Math.sin(emitAngle) * speed,
          life: 600 + Math.random() * 600,
          maxLife: 600 + Math.random() * 600,
          size: size * (0.06 + Math.random() * 0.1),
          alpha: 0.8 + Math.random() * 0.2,
          color: BOOST_COLORS[Math.floor(Math.random() * BOOST_COLORS.length)]!,
        })
      }
    }
  }

  ctx.save()
  for (let i = boostParticles.length - 1; i >= 0; i--) {
    const p = boostParticles[i]!
    p.x += p.vx * 0.02
    p.y += p.vy * 0.02
    p.vx *= 0.97
    p.vy *= 0.97
    p.life -= 16
    p.alpha = Math.max(0, p.life / p.maxLife)
    p.size *= 0.99

    if (p.life <= 0 || p.alpha <= 0) {
      boostParticles.splice(i, 1)
      continue
    }

    const px = p.x * size
    const py = p.y * size
    ctx.globalAlpha = p.alpha
    ctx.shadowColor = p.color
    ctx.shadowBlur = 16
    ctx.fillStyle = p.color
    ctx.beginPath()
    ctx.arc(px, py, p.size, 0, Math.PI * 2)
    ctx.fill()
  }

  if (boosting.value && segments.value[0]) {
    const head = segments.value[0]
    const angle = direction.value
    const hx = head.x * size
    const hy = head.y * size
    const t = now
    ctx.globalAlpha = 0.3
    ctx.shadowBlur = 0
    for (let i = 0; i < 5; i++) {
      const offset = Math.sin(t * 0.012 + i * 1.4) * size * 0.35
      const perp = angle + Math.PI / 2
      const px = hx + Math.cos(perp) * offset
      const py = hy + Math.sin(perp) * offset
      const len = size * (0.6 + 0.4 * Math.sin(t * 0.01 + i * 1.1))
      const grad = ctx.createLinearGradient(
        px - Math.cos(angle) * size * 0.3, py - Math.sin(angle) * size * 0.3,
        px - Math.cos(angle) * (size * 0.3 + len), py - Math.sin(angle) * (size * 0.3 + len)
      )
      grad.addColorStop(0, 'rgba(255, 200, 50, 0.6)')
      grad.addColorStop(0.5, 'rgba(255, 100, 20, 0.3)')
      grad.addColorStop(1, 'rgba(255, 50, 0, 0)')
      ctx.strokeStyle = grad
      ctx.lineWidth = size * 0.10 + size * 0.04 * Math.sin(t * 0.008 + i * 0.9)
      ctx.beginPath()
      ctx.moveTo(px - Math.cos(angle) * size * 0.3, py - Math.sin(angle) * size * 0.3)
      ctx.lineTo(px - Math.cos(angle) * (size * 0.3 + len), py - Math.sin(angle) * (size * 0.3 + len))
      ctx.stroke()
    }
  }

  ctx.restore()
}

function drawFood(ctx: CanvasRenderingContext2D, size: number) {
  if (!serverState.value) return
  serverState.value.foods.forEach(f => {
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

function drawShockwave(ctx: CanvasRenderingContext2D, size: number) {
  if (!serverState.value) return
  const now = serverState.value.tickCount * 50
  for (const sw of serverState.value.shockwaves) {
    const age = now - sw.spawnTick * 50
    if (age < 0 || age > 2000) continue
    const t = age / 2000

    // Spawn local particles from shockwave
    if (!processedShockwaves.has(sw.spawnTick) && age < 100) {
      processedShockwaves.add(sw.spawnTick)
      for (let i = 0; i < 20; i++) {
        const angle = Math.random() * Math.PI * 2
        const speed = 1 + Math.random() * 4
        collisionParticles.push({
          x: sw.x, y: sw.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 800 + Math.random() * 800,
          maxLife: 800 + Math.random() * 800,
          size: size * (0.04 + Math.random() * 0.1),
          color: ['#ffd700', '#ffe44d', '#ffffff', '#ffaa00', '#ffcc00'][Math.floor(Math.random() * 5)]!,
        })
      }
    }

    const sx = sw.x * size
    const sy = sw.y * size
    const maxR = 4 * size
    ctx.save()

    // Ring 1 - outer thick
    ctx.save()
    ctx.strokeStyle = `rgba(255, 215, 0, ${(1 - t) * 0.25})`
    ctx.lineWidth = (1 - t) * size * 1.0 + 1
    ctx.shadowColor = '#ffd700'
    ctx.shadowBlur = 15
    ctx.beginPath()
    ctx.arc(sx, sy, t * maxR, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()

    // Ring 2 - inner bright
    ctx.save()
    ctx.strokeStyle = `rgba(255, 255, 200, ${(1 - t) * 0.5})`
    ctx.lineWidth = (1 - t) * size * 0.5 + 0.5
    ctx.shadowColor = '#ffee88'
    ctx.shadowBlur = 20
    ctx.beginPath()
    ctx.arc(sx, sy, t * maxR * 0.8, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()

    // Ring 3 - core white flash
    if (t < 0.3) {
      const coreT = t / 0.3
      ctx.save()
      ctx.fillStyle = `rgba(255, 255, 255, ${(1 - coreT) * 0.6})`
      ctx.shadowColor = '#ffffff'
      ctx.shadowBlur = 30
      ctx.beginPath()
      ctx.arc(sx, sy, size * (0.5 + coreT * 2), 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    ctx.restore()
  }
}

function drawCollisionParticles(ctx: CanvasRenderingContext2D, size: number) {
  ctx.save()
  for (let i = collisionParticles.length - 1; i >= 0; i--) {
    const p = collisionParticles[i]!
    p.x += p.vx * 0.02
    p.y += p.vy * 0.02
    p.vx *= 0.97
    p.vy *= 0.97
    p.life -= 16
    const alpha = Math.max(0, p.life / p.maxLife)
    p.size *= 0.998

    if (p.life <= 0) {
      collisionParticles.splice(i, 1)
      continue
    }

    const px = p.x * size
    const py = p.y * size
    ctx.globalAlpha = alpha
    ctx.shadowColor = p.color
    ctx.shadowBlur = 12
    ctx.fillStyle = p.color
    ctx.beginPath()
    ctx.arc(px, py, p.size, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
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

function drawLaserItem(ctx: CanvasRenderingContext2D, size: number) {
  laserAnim++
  laserItems.value.forEach(item => drawItemBlink(ctx, size, item, laserAnim, '#00ddff', '#00ffff', '🔫'))
}

function drawMagnetEffect(ctx: CanvasRenderingContext2D, size: number) {
  const me = serverState.value?.players[myId.value]
  if (!me?.magnetActive) return
  magnetAnim++
  const head = me.segments[0]
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

function drawLaser(ctx: CanvasRenderingContext2D, size: number) {
  const now = performance.now()
  for (let i = laserFlashes.length - 1; i >= 0; i--) {
    const flash = laserFlashes[i]!
    const age = now - flash.time
    if (age > 300) {
      laserFlashes.splice(i, 1)
      continue
    }

    const ox = flash.originX * size
    const oy = flash.originY * size
    const dir = flash.direction
    const range = 50 * size
    const ex = ox + Math.cos(dir) * range
    const ey = oy + Math.sin(dir) * range
    const alpha = Math.max(0, 1 - age / 300)

    ctx.save()

    // Outer glow
    ctx.shadowColor = '#00ddff'
    ctx.shadowBlur = 40
    ctx.strokeStyle = `rgba(0, 220, 255, ${0.25 * alpha})`
    ctx.lineWidth = size * 2
    ctx.beginPath()
    ctx.moveTo(ox, oy)
    ctx.lineTo(ex, ey)
    ctx.stroke()

    // Main beam
    ctx.shadowColor = '#00ffff'
    ctx.shadowBlur = 25
    ctx.strokeStyle = `rgba(100, 255, 255, ${0.5 * alpha})`
    ctx.lineWidth = size * 1.2
    ctx.beginPath()
    ctx.moveTo(ox, oy)
    ctx.lineTo(ex, ey)
    ctx.stroke()

    // Bright core
    ctx.shadowColor = '#ffffff'
    ctx.shadowBlur = 15
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.85 * alpha})`
    ctx.lineWidth = size * 0.4
    ctx.beginPath()
    ctx.moveTo(ox, oy)
    ctx.lineTo(ex, ey)
    ctx.stroke()

    ctx.restore()
  }
}

function resizeCanvas() {
  const c = canvas.value
  if (!c) return
  const dpr = window.devicePixelRatio || 1
  const w = window.innerWidth
  const h = window.innerHeight

  const size = Math.floor(Math.min(w, h) / GRID_ROWS)
  cellSize.value = size

  const screenArea = w * h
  const worldArea = screenArea * 7
  const worldRadiusPx = Math.sqrt(worldArea / Math.PI)
  worldRadius.value = worldRadiusPx / size

  c.width = w * dpr
  c.height = h * dpr
  c.style.width = `${w}px`
  c.style.height = `${h}px`
  const ctx = c.getContext('2d')
  if (ctx) ctx.scale(dpr, dpr)
}
</script>

<template>
  <div class="canvas-wrapper">
    <canvas ref="canvas" id="gameCanvas" @mousemove="onCanvasMouseMove"></canvas>

    <!-- Desktop Lobby -->
    <template v-if="!isMobile">
      <!-- Playing HUD -->
      <div v-if="gamePhase === 'playing'" class="score-bar">
        分數：<strong>{{ score }}</strong>　👻 {{ phantoms }}　🛡️ {{ shields }}　🔫 {{ laserCharges }}
        <span v-if="phantomActive" class="phantom-badge">虛化 {{ phantomTimeLeft }}s</span>
        <span v-if="magnetTimeLeft" class="magnet-countdown">🧲 {{ magnetTimeLeft }}s</span>
        <span class="player-count">　玩家：{{ alivePlayerCount() }}</span>
      </div>

      <!-- Lobby -->
      <div class="overlay" v-if="gamePhase === 'lobby'">
        <div class="overlay-content">
          <div class="lobby-card">
            <h1>🐍 多人貪食蛇</h1>
            <p v-if="errorMsg" class="error-msg">{{ errorMsg }}</p>
            <p v-if="!connected" class="connecting">連線中...</p>

            <template v-if="!roomCode">
              <button class="btn" @click="createRoom" :disabled="!connected">建立房間</button>
              <div class="divider">或</div>
              <div class="join-row">
                <input class="code-input" v-model="joinCodeInput" placeholder="輸入房間代碼" maxlength="4"
                       @keyup.enter="joinRoom" />
                <button class="btn btn-sm" @click="joinRoom" :disabled="!connected || !joinCodeInput.trim()">加入</button>
              </div>
            </template>

            <template v-else>
              <div class="room-code-display">
                房間代碼：<strong>{{ roomCode }}</strong>
              </div>
              <div class="player-list">
                <div v-for="(p, i) in playersInRoom" :key="p.id" class="player-item"
                     :class="{ host: i === 0, me: p.id === myId }">
                  <span class="player-dot" :style="{ background: playerColor(i) }"></span>
                  {{ p.username }}{{ i === 0 ? ' 👑' : '' }}{{ p.id === myId ? ' (你)' : '' }}
                </div>
              </div>
              <div v-if="isHost" class="start-row">
                <button class="btn" @click="startGame" :disabled="playersInRoom.length < 1">開始遊戲</button>
              </div>
              <button class="btn btn-secondary" @click="leaveRoom">離開房間</button>
            </template>
          </div>
        </div>
      </div>

      <!-- Dead overlay (spectator mode) -->
      <div class="overlay" v-if="gamePhase === 'dead'">
        <div class="overlay-content">
          <div class="lobby-card">
            <h1>💀 你已死亡</h1>
            <p class="dead-subtitle">觀戰中</p>
            <div class="btn-row">
              <button class="btn" @click="returnToGame">返回遊戲</button>
              <button class="btn btn-secondary" @click="backToLobby">返回大廳</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Game Over -->
      <div class="overlay" v-if="gamePhase === 'gameover'">
        <div class="overlay-content">
          <div class="lobby-card">
            <h1>💀 遊戲結束</h1>
            <div class="result-list">
              <div v-for="(r, i) in gameResults" :key="r.id" class="result-item"
                   :class="{ winner: r.alive, me: r.id === myId }">
                <span class="rank">{{ i + 1 }}</span>
                <span class="player-dot" :style="{ background: playerColor(i) }"></span>
                {{ r.username }}{{ r.id === myId ? ' (你)' : '' }}
                <span class="result-score">{{ r.score }}</span>
                <span v-if="r.alive" class="winner-badge">🏆</span>
              </div>
            </div>
            <div class="btn-row">
              <button v-if="isHost" class="btn" @click="restartGame">🔄 重新開始</button>
              <button class="btn btn-secondary" @click="backToLobby">返回大廳</button>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Mobile: portrait hint -->
    <template v-else-if="!isLandscape">
      <div class="rotate-hint">
        <div class="rotate-icon">↻</div>
        <p>請旋轉手機以開始遊戲</p>
      </div>
    </template>

    <!-- Mobile: game + lobby -->
    <template v-else>
      <div v-if="gamePhase === 'playing'" class="score-bar score-bar-mobile">
        分數：<strong>{{ score }}</strong>　👻 {{ phantoms }}　🛡️ {{ shields }}　🔫 {{ laserCharges }}
        <span v-if="phantomActive" class="phantom-badge">虛化 {{ phantomTimeLeft }}s</span>
        <span v-if="magnetTimeLeft" class="magnet-countdown">🧲 {{ magnetTimeLeft }}s</span>
      </div>

      <div class="joystick" ref="joystickRef" v-if="gamePhase === 'playing'">
        <div class="joystick-ring">
          <span class="arrow up">↑</span>
          <span class="arrow right">→</span>
          <span class="arrow down">↓</span>
          <span class="arrow left">←</span>
          <div class="joystick-knob" :class="{ active: jActive }" :style="knobStyle"></div>
        </div>
      </div>

      <button class="phantom-btn" v-if="gamePhase === 'playing'" @click="activatePhantomSkill">
        👻 {{ phantoms }}
      </button>

      <button class="laser-btn" v-if="gamePhase === 'playing'" @click="fireLaserSkill">
        🔫 {{ laserCharges }}
      </button>

      <div class="overlay" v-if="gamePhase === 'lobby'">
        <div class="overlay-content">
          <div class="lobby-card">
            <h1>🐍 多人貪食蛇</h1>
            <p v-if="errorMsg" class="error-msg">{{ errorMsg }}</p>
            <p v-if="!connected" class="connecting">連線中...</p>

            <template v-if="!roomCode">
              <button class="btn" @click="createRoom" :disabled="!connected">建立房間</button>
              <div class="divider">或</div>
              <div class="join-row">
                <input class="code-input" v-model="joinCodeInput" placeholder="房間代碼" maxlength="4"
                       @keyup.enter="joinRoom" />
                <button class="btn btn-sm" @click="joinRoom" :disabled="!connected || !joinCodeInput.trim()">加入</button>
              </div>
            </template>

            <template v-else>
              <div class="room-code-display">
                房間代碼：<strong>{{ roomCode }}</strong>
              </div>
              <div class="player-list">
                <div v-for="(p, i) in playersInRoom" :key="p.id" class="player-item"
                     :class="{ host: i === 0, me: p.id === myId }">
                  <span class="player-dot" :style="{ background: playerColor(i) }"></span>
                  {{ p.username }}{{ i === 0 ? ' 👑' : '' }}{{ p.id === myId ? ' (你)' : '' }}
                </div>
              </div>
              <div v-if="isHost" class="start-row">
                <button class="btn" @click="startGame" :disabled="playersInRoom.length < 1">開始遊戲</button>
              </div>
              <button class="btn btn-secondary" @click="leaveRoom">離開房間</button>
            </template>
          </div>
        </div>
      </div>

      <!-- Dead overlay (mobile) -->
      <div class="overlay" v-if="gamePhase === 'dead'">
        <div class="overlay-content">
          <div class="lobby-card">
            <h1>💀 你已死亡</h1>
            <p class="dead-subtitle">觀戰中</p>
            <div class="btn-row">
              <button class="btn" @click="returnToGame">返回遊戲</button>
              <button class="btn btn-secondary" @click="backToLobby">返回大廳</button>
            </div>
          </div>
        </div>
      </div>

      <div class="overlay" v-if="gamePhase === 'gameover'">
        <div class="overlay-content">
          <div class="lobby-card">
            <h1>💀 遊戲結束</h1>
            <div class="result-list">
              <div v-for="(r, i) in gameResults" :key="r.id" class="result-item"
                   :class="{ winner: r.alive, me: r.id === myId }">
                <span class="rank">{{ i + 1 }}</span>
                <span class="player-dot" :style="{ background: playerColor(i) }"></span>
                {{ r.username }}{{ r.id === myId ? ' (你)' : '' }}
                <span class="result-score">{{ r.score }}</span>
                <span v-if="r.alive" class="winner-badge">🏆</span>
              </div>
            </div>
            <div class="btn-row">
              <button v-if="isHost" class="btn" @click="restartGame">🔄 重新開始</button>
              <button class="btn btn-secondary" @click="backToLobby">返回大廳</button>
            </div>
          </div>
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

.player-count {
  font-size: 16px;
  opacity: 0.7;
}

.phantom-badge {
  font-size: 14px;
  background: rgba(170, 136, 255, 0.3);
  color: #c8aaff;
  border: 1px solid rgba(170, 136, 255, 0.5);
  border-radius: 4px;
  padding: 1px 8px;
  margin-left: 8px;
  vertical-align: middle;
}

.magnet-countdown {
  font-size: 14px;
  background: rgba(68, 136, 255, 0.3);
  color: #88bbff;
  border: 1px solid rgba(68, 136, 255, 0.5);
  border-radius: 4px;
  padding: 1px 8px;
  margin-left: 8px;
  vertical-align: middle;
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

.connecting {
  font-size: 16px !important;
  opacity: 0.6;
}

.error-msg {
  font-size: 14px !important;
  color: #ff6b6b;
}

.lobby-card {
  background: #16213e;
  padding: 28px 32px;
  border-radius: 16px;
  width: 360px;
  max-width: 85vw;
  text-align: center;
  color: #fff;
}

.lobby-card h1 {
  margin: 0 0 16px;
  font-size: 24px;
}

.divider {
  margin: 12px 0;
  opacity: 0.4;
  font-size: 14px;
}

.join-row {
  display: flex;
  gap: 8px;
  justify-content: center;
  align-items: center;
}

.code-input {
  width: 120px;
  padding: 10px 12px;
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 8px;
  background: rgba(255,255,255,0.06);
  color: #fff;
  font-size: 18px;
  text-align: center;
  letter-spacing: 4px;
  text-transform: uppercase;
  outline: none;
}

.code-input:focus {
  border-color: #4caf50;
}

.room-code-display {
  font-size: 18px;
  margin-bottom: 16px;
}

.room-code-display strong {
  font-size: 32px;
  color: #4caf50;
  letter-spacing: 6px;
}

.player-list {
  margin-bottom: 16px;
}

.player-item {
  padding: 8px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  border-radius: 8px;
  background: rgba(255,255,255,0.04);
  margin-bottom: 4px;
}

.player-item.host {
  background: rgba(255,215,0,0.08);
}

.player-item.me {
  font-weight: 700;
}

.player-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
}

.start-row {
  margin-bottom: 8px;
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
  font-family: inherit;
}

.btn:hover {
  background: #43a047;
}

.btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.btn-secondary {
  background: rgba(255,255,255,0.1);
  font-size: 14px;
  padding: 8px 24px;
  margin-top: 8px;
}

.btn-secondary:hover {
  background: rgba(255,255,255,0.15);
}

.btn-sm {
  padding: 10px 20px;
  font-size: 16px;
}

.result-list {
  margin-bottom: 16px;
}

.result-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(255,255,255,0.04);
  margin-bottom: 4px;
  font-size: 16px;
}

.result-item.winner {
  background: rgba(255,215,0,0.12);
}

.result-item.me {
  font-weight: 700;
}

.rank {
  width: 24px;
  text-align: center;
  opacity: 0.5;
  font-size: 14px;
}

.result-score {
  margin-left: auto;
  font-weight: 700;
  color: #4caf50;
}

.winner-badge {
  margin-left: 4px;
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

.btn-row {
  display: flex;
  gap: 8px;
  justify-content: center;
  flex-wrap: wrap;
  margin-top: 16px;
}

.btn-row .btn-secondary {
  margin-top: 0;
}

.dead-subtitle {
  text-align: center;
  color: #aaa;
  font-size: 14px;
  margin-top: -8px;
  margin-bottom: 8px;
}

.phantom-btn {
  position: absolute;
  bottom: calc(40px + env(safe-area-inset-bottom, 0px));
  right: calc(12px + env(safe-area-inset-right, 0px));
  z-index: 2;
  font-size: 24px;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: rgba(170, 136, 255, 0.25);
  border: 2px solid rgba(170, 136, 255, 0.4);
  color: #c8aaff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  touch-action: none;
  transition: background 0.15s, box-shadow 0.15s;
}
.phantom-btn:active {
  background: rgba(170, 136, 255, 0.5);
  box-shadow: 0 0 16px rgba(170, 136, 255, 0.4);
}

.laser-btn {
  position: absolute;
  bottom: calc(100px + env(safe-area-inset-bottom, 0px));
  right: calc(12px + env(safe-area-inset-right, 0px));
  z-index: 2;
  font-size: 24px;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: rgba(0, 200, 255, 0.2);
  border: 2px solid rgba(0, 200, 255, 0.4);
  color: #88eeff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  touch-action: none;
  transition: background 0.15s, box-shadow 0.15s;
}
.laser-btn:active {
  background: rgba(0, 200, 255, 0.5);
  box-shadow: 0 0 16px rgba(0, 200, 255, 0.4);
}
</style>
