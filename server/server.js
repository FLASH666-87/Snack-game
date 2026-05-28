import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { createServer } from 'node:http'
import { Server } from 'socket.io'
import { createRoomState, createPlayerState, MIN_WORLD_RADIUS } from './GameState.js'
import { tick, TICK_MS, processInput, activatePhantom, activateLaser, getBroadcastState } from './GameEngine.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_FILE = join(__dirname, 'data', 'scores.json')

function ensureDataFile() {
  const dir = dirname(DATA_FILE)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  if (!existsSync(DATA_FILE)) writeFileSync(DATA_FILE, '[]', 'utf-8')
}

function readScores() {
  ensureDataFile()
  try {
    return JSON.parse(readFileSync(DATA_FILE, 'utf-8'))
  } catch {
    return []
  }
}

function writeScores(scores) {
  ensureDataFile()
  writeFileSync(DATA_FILE, JSON.stringify(scores, null, 2), 'utf-8')
}

const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
})

// Room management
const rooms = new Map()
const roomTimers = new Map()

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code
  do {
    code = ''
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)]
  } while (rooms.has(code))
  return code
}

function startRoomGameLoop(roomCode) {
  const room = rooms.get(roomCode)
  if (!room || room.status !== 'playing') return

  room.status = 'playing'
  const interval = setInterval(() => {
    const r = rooms.get(roomCode)
    if (!r || r.status === 'finished') {
      clearInterval(interval)
      roomTimers.delete(roomCode)
      return
    }
    tick(r)
    io.to(roomCode).emit('game_state', getBroadcastState(r))

    // Clear laser firing states after broadcast so they show for one frame
    for (const [, player] of r.players) {
      player.firingLaser = false
    }

    if (r.status === 'finished') {
      clearInterval(interval)
      roomTimers.delete(roomCode)
      const results = [...r.players.values()].map(p => ({
        id: p.id, username: p.username, score: p.score, alive: p.alive,
      }))
      // Auto-save scores
      const scores = readScores()
      for (const p of results) {
        if (p.score > 0 && p.username) {
          const existing = scores.find(s => s.username === p.username)
          if (existing) {
            if (p.score > existing.highScore) existing.highScore = p.score
          } else {
            scores.push({ username: p.username, highScore: p.score })
          }
        }
      }
      writeScores(scores)
      io.to(roomCode).emit('game_over', results)
      // Schedule room cleanup
      setTimeout(() => {
        rooms.delete(roomCode)
        roomTimers.delete(roomCode)
      }, 60000)
    }
  }, TICK_MS)
  roomTimers.set(roomCode, interval)
}

// --- REST API (keep existing) ---
app.use(express.json())

app.get('/api/leaderboard', (req, res) => {
  const scores = readScores()
  scores.sort((a, b) => b.highScore - a.highScore)
  res.json(scores)
})

app.post('/api/scores', (req, res) => {
  const { username, score } = req.body
  if (!username || typeof score !== 'number') {
    return res.status(400).json({ error: 'username and score required' })
  }
  const scores = readScores()
  const existing = scores.find(s => s.username === username)
  if (existing) {
    if (score > existing.highScore) {
      existing.highScore = score
    }
  } else {
    scores.push({ username, highScore: score })
  }
  writeScores(scores)
  res.json({ ok: true })
})

// --- Socket.IO ---
io.on('connection', (socket) => {
  let currentRoom = ''
  let currentUsername = ''

  socket.on('create_room', ({ username }) => {
    if (!username) return socket.emit('error', '缺少使用者名稱')
    currentUsername = username
    const roomCode = generateRoomCode()
    const room = createRoomState(roomCode)
    rooms.set(roomCode, room)
    socket.join(roomCode)
    currentRoom = roomCode

    const player = createPlayerState(socket.id, username)
    room.players.set(socket.id, player)

    socket.emit('room_created', { roomCode })
    io.to(roomCode).emit('room_state', getRoomState(room))
  })

  socket.on('join_room', ({ roomCode, username }) => {
    if (!username) return socket.emit('error', '缺少使用者名稱')
    const room = rooms.get(roomCode)
    if (!room) return socket.emit('error', '房間不存在')
    if (room.status !== 'waiting') return socket.emit('error', '遊戲已開始，無法加入')
    if (room.players.size >= room.maxPlayers) return socket.emit('error', '房間已滿')

    currentUsername = username
    socket.join(roomCode)
    currentRoom = roomCode

    const player = createPlayerState(socket.id, username)
    room.players.set(socket.id, player)

    io.to(roomCode).emit('room_state', getRoomState(room))
  })

  socket.on('start_game', () => {
    const room = rooms.get(currentRoom)
    if (!room) return socket.emit('error', '不在房間中')
    // Only host can start
    const firstPlayer = room.players.keys().next().value
    if (firstPlayer !== socket.id) return socket.emit('error', '只有房主能開始')
    if (room.players.size < 1) return socket.emit('error', '至少需要 1 名玩家')

    // Reset all player positions & spread them out
    const playerArray = [...room.players.values()]
    const spawnRadius = 20
    for (let i = 0; i < playerArray.length; i++) {
      const p = playerArray[i]
      const fresh = createPlayerState(p.id, p.username)
      Object.assign(p, fresh)
      const angle = (i / playerArray.length) * Math.PI * 2
      const cx = Math.cos(angle) * spawnRadius
      const cy = Math.sin(angle) * spawnRadius
      // Rotate & translate path so snake faces outward
      p.path = p.path.map(pt => ({
        x: pt.x * Math.cos(angle) - pt.y * Math.sin(angle) + cx,
        y: pt.x * Math.sin(angle) + pt.y * Math.cos(angle) + cy,
      }))
      p.segments = p.segments.map(s => ({
        x: s.x * Math.cos(angle) - s.y * Math.sin(angle) + cx,
        y: s.x * Math.sin(angle) + s.y * Math.cos(angle) + cy,
      }))
      p.direction = angle
      p.targetDirection = angle
    }

    room.status = 'playing'
    startRoomGameLoop(currentRoom)
    io.to(currentRoom).emit('game_started')
  })

  socket.on('restart_game', () => {
    const room = rooms.get(currentRoom)
    if (!room) return socket.emit('error', '不在房間中')
    const firstPlayer = room.players.keys().next().value
    if (firstPlayer !== socket.id) return socket.emit('error', '只有房主能重新開始')
    if (room.status !== 'finished') return
    // Reset room & players back to waiting
    room.status = 'waiting'
    room.tickCount = 0
    room.foods = []
    room.phantomItems = []
    room.shieldItems = []
    room.dietItems = []
    room.magnetItems = []
    room.laserItems = []
    room.worldRadius = MIN_WORLD_RADIUS
    for (const [id, p] of room.players) {
      const fresh = createPlayerState(id, p.username)
      Object.assign(p, fresh)
    }
    io.to(currentRoom).emit('room_state', getRoomState(room))
  })

  socket.on('player_input', (input) => {
    const room = rooms.get(currentRoom)
    if (!room) return
    const player = room.players.get(socket.id)
    if (!player || !player.alive) return
    processInput(player, input)
  })

  socket.on('activate_phantom', () => {
    const room = rooms.get(currentRoom)
    if (!room || room.status !== 'playing') return
    const player = room.players.get(socket.id)
    if (!player || !player.alive) return
    const now = room.tickCount * TICK_MS
    activatePhantom(player, now)
  })

  socket.on('activate_laser', () => {
    const room = rooms.get(currentRoom)
    if (!room || room.status !== 'playing') return
    const player = room.players.get(socket.id)
    if (!player || !player.alive) return
    const now = room.tickCount * TICK_MS
    activateLaser(player, room, now)
  })

  socket.on('respawn', () => {
    const room = rooms.get(currentRoom)
    if (!room || room.status !== 'playing') return
    const p = room.players.get(socket.id)
    if (!p || p.alive) return

    const fresh = createPlayerState(p.id, p.username)
    Object.assign(p, fresh)

    const angle = Math.random() * Math.PI * 2
    const cx = Math.cos(angle) * 20
    const cy = Math.sin(angle) * 20
    p.path = p.path.map(pt => ({
      x: pt.x * Math.cos(angle) - pt.y * Math.sin(angle) + cx,
      y: pt.x * Math.sin(angle) + pt.y * Math.cos(angle) + cy,
    }))
    p.segments = p.segments.map(s => ({
      x: s.x * Math.cos(angle) - s.y * Math.sin(angle) + cx,
      y: s.x * Math.sin(angle) + s.y * Math.cos(angle) + cy,
    }))
    p.direction = angle
    p.targetDirection = angle
    p.alive = true
  })

  socket.on('disconnect', () => {
    if (currentRoom) {
      const room = rooms.get(currentRoom)
      if (room) {
        room.players.delete(socket.id)
        if (room.players.size === 0) {
          rooms.delete(currentRoom)
          roomTimers.delete(currentRoom)
        } else {
          io.to(currentRoom).emit('room_state', getRoomState(room))
        }
      }
    }
  })

  socket.on('leave_room', () => {
    if (currentRoom) {
      const room = rooms.get(currentRoom)
      if (room) {
        room.players.delete(socket.id)
        if (room.players.size === 0) {
          rooms.delete(currentRoom)
          roomTimers.delete(currentRoom)
        } else {
          io.to(currentRoom).emit('room_state', getRoomState(room))
        }
      }
      socket.leave(currentRoom)
      currentRoom = ''
    }
  })
})

function getRoomState(room) {
  const players = [...room.players.values()].map(p => ({
    id: p.id,
    username: p.username,
    alive: p.alive,
  }))
  return {
    roomCode: room.roomCode,
    players,
    status: room.status,
    maxPlayers: room.maxPlayers,
  }
}

const PORT = process.env.PORT || 3001
httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
