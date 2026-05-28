import {
  SEGMENT_SPACING, INITIAL_SEGMENTS, ROTATION_SPEED,
  WORLD_GROWTH_PER_SCORE, MIN_WORLD_RADIUS,
  FOOD_TYPES, PHANTOM_LIFETIME, SKILL_TYPES_COUNT, LASER_RANGE,
} from './GameState.js'

const TICK_MS = 50
const BOOST_GROWTH_DRAIN = 4

export { TICK_MS }

export function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a
}

function dist(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

function randomPointInCircle(r) {
  const angle = Math.random() * Math.PI * 2
  const radius = Math.sqrt(Math.random()) * r
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }
}

function clampToWorld(pos, worldRadius) {
  const d = Math.hypot(pos.x, pos.y)
  if (d >= worldRadius) {
    const angle = Math.atan2(pos.y, pos.x)
    pos.x = Math.cos(angle) * (worldRadius - 0.01)
    pos.y = Math.sin(angle) * (worldRadius - 0.01)
  }
}

function updateBody(player) {
  const { path, segments, growCounter } = player
  const totalSegs = INITIAL_SEGMENTS + growCounter
  const newSegs = []
  let accumulated = 0
  let pathIdx = 0

  for (let i = 0; i < totalSegs; i++) {
    const targetDist = i * SEGMENT_SPACING
    while (pathIdx < path.length - 1) {
      const p0 = path[pathIdx]
      const p1 = path[pathIdx + 1]
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
    player.segments = newSegs
  }

  const keepLen = totalSegs * SEGMENT_SPACING + SEGMENT_SPACING * 4
  let totalDist = 0
  for (let i = 1; i < path.length; i++) {
    totalDist += dist(path[i - 1], path[i])
    if (totalDist > keepLen) {
      player.path = path.slice(0, i + 1)
      return
    }
  }
}

function isAlive(player, now) {
  return player.alive
}

function triggerInvincible(player, duration, now) {
  player.invincibleEndTime = now + duration
}

function consumeShield(player, now) {
  if (now < player.invincibleEndTime) return 'invincible'
  if (player.shields <= 0) return false
  player.shields--
  triggerInvincible(player, 3000, now)
  return 'consumed'
}

export function activatePhantom(player, now) {
  if (player.phantomCharges <= 0 || player.phantomActive) return false
  player.phantomCharges--
  player.phantomActive = true
  player.phantomEndTime = now + PHANTOM_LIFETIME
  return true
}

export function activateLaser(player, roomState, now) {
  if (player.laserCharges <= 0 || player.firingLaser) return false
  player.laserCharges--
  player.firingLaser = true
  player.laserDirection = player.direction
  const head = player.segments[0]
  if (head) {
    player.laserOriginX = head.x
    player.laserOriginY = head.y
  }
  return true
}

export function processInput(player, input) {
  if (input.targetDirection !== undefined) {
    player.targetDirection = input.targetDirection
  }
  if (input.boosting !== undefined) {
    if (input.boosting && player.growCounter <= 0) {
      player.boosting = false
    } else {
      player.boosting = input.boosting
    }
  }
}

export function tick(roomState) {
  const now = roomState.tickCount * TICK_MS
  const dt = TICK_MS
  roomState.tickCount++

  let alivePlayers = [...roomState.players.values()].filter(p => p.alive)

  // Update each player
  for (const player of alivePlayers) {
    updatePlayer(player, dt, roomState, now)
  }

  // Process lasers (before collision so laser fires even if shooter dies this tick)
  for (const [, player] of roomState.players) {
    if (player.firingLaser && player.alive) {
      processLaser(player, roomState, now)
    }
  }

  // Player-player collision
  for (let i = 0; i < alivePlayers.length; i++) {
    for (let j = i + 1; j < alivePlayers.length; j++) {
      const a = alivePlayers[i]
      const b = alivePlayers[j]
      // Phantom players phase through all collisions
      if (a.phantomActive || b.phantomActive) continue
      const headA = a.segments[0]
      const headB = b.segments[0]
      if (!headA || !headB) continue
      // A's head hits B's body
      const hitB = checkSnakeCollision(a, b)
      if (hitB >= 0) {
        const shieldResult = consumeShield(a, now)
        if (shieldResult) {
          if (shieldResult === 'consumed') {
            roomState.shockwaves.push({ x: headA.x, y: headA.y, spawnTick: roomState.tickCount })
          }
          const push = computeReflection(headA, b.segments, hitB, a.direction, a.boosting)
          a.knockbackX += push.x
          a.knockbackY += push.y
        } else {
          a.alive = false
          a.segments = []
        }
      }
      else {
        const hitA = checkSnakeCollision(b, a)
        if (hitA >= 0) {
          const shieldResult = consumeShield(b, now)
          if (shieldResult) {
            if (shieldResult === 'consumed') {
              roomState.shockwaves.push({ x: headB.x, y: headB.y, spawnTick: roomState.tickCount })
            }
            const push = computeReflection(headB, a.segments, hitA, b.direction, b.boosting)
            b.knockbackX += push.x
            b.knockbackY += push.y
          } else {
            b.alive = false
            b.segments = []
          }
        }
      }
    }
  }

  // Re-filter after collisions
  alivePlayers = [...roomState.players.values()].filter(p => p.alive)

  // Apply knockback to all alive players
  for (const player of roomState.players.values()) {
    if (!player.alive) continue
    if (Math.abs(player.knockbackX) < 0.001 && Math.abs(player.knockbackY) < 0.001) continue
    for (const seg of player.segments) {
      seg.x += player.knockbackX
      seg.y += player.knockbackY
    }
    for (const p of player.path) {
      p.x += player.knockbackX
      p.y += player.knockbackY
    }
    player.knockbackX *= 0.85
    player.knockbackY *= 0.85
  }

  // Food / item collection
  for (const player of alivePlayers) {
    collectItems(player, roomState, now)
  }

  // Immediately reflect growCounter changes (diet pills via magnet)
  for (const player of alivePlayers) {
    updateBody(player)
  }

  // Spawn food
  maintainFood(roomState, alivePlayers.length)
  maintainSkillItems(roomState)

  // Clean up expired items
  const itemAge = now
  roomState.phantomItems = roomState.phantomItems.filter(i => itemAge - i.spawnTick * TICK_MS < PHANTOM_LIFETIME)
  roomState.shieldItems = roomState.shieldItems.filter(i => itemAge - i.spawnTick * TICK_MS < PHANTOM_LIFETIME)
  roomState.dietItems = roomState.dietItems.filter(i => itemAge - i.spawnTick * TICK_MS < PHANTOM_LIFETIME)
  roomState.magnetItems = roomState.magnetItems.filter(i => itemAge - i.spawnTick * TICK_MS < PHANTOM_LIFETIME)
  roomState.laserItems = roomState.laserItems.filter(i => itemAge - i.spawnTick * TICK_MS < PHANTOM_LIFETIME)

  // Clean up expired shockwaves (2 seconds)
  roomState.shockwaves = roomState.shockwaves.filter(s => itemAge - s.spawnTick * TICK_MS < 2000)

  // Update world radius based on total score
  const totalScore = alivePlayers.reduce((s, p) => s + p.score, 0)
  roomState.worldRadius = MIN_WORLD_RADIUS + totalScore * WORLD_GROWTH_PER_SCORE

  // Check if game should end (only when NO players remain)
  if (alivePlayers.length === 0 && roomState.status === 'playing') {
    roomState.status = 'finished'
  }
}

function updatePlayer(player, dt, roomState, now) {
  const { path, segments } = player
  if (!segments[0]) return

  // Smooth rotation toward target
  let diff = player.targetDirection - player.direction
  while (diff > Math.PI) diff -= Math.PI * 2
  while (diff < -Math.PI) diff += Math.PI * 2
  if (Math.abs(diff) < ROTATION_SPEED) {
    player.direction = normalizeAngle(player.targetDirection)
  } else {
    player.direction += Math.sign(diff) * ROTATION_SPEED
    player.direction = normalizeAngle(player.direction)
  }

  // Move head
  const speed = player.boosting ? 15 : 8
  const step = speed * dt / 1000
  const head = segments[0]
  head.x += Math.cos(player.direction) * step
  head.y += Math.sin(player.direction) * step

  // Boost drain
  if (player.boosting && player.growCounter > 0) {
    player.growCounter = Math.max(0, player.growCounter - BOOST_GROWTH_DRAIN * dt / 1000)
    if (player.growCounter === 0) player.boosting = false
  }

  // Clamp to world
  clampToWorld(head, roomState.worldRadius)

  // Update body
  path.unshift({ ...head })
  updateBody(player)

  // Timed effects
  if (player.phantomActive && now >= player.phantomEndTime) {
    player.phantomActive = false
    player.phantomEndTime = 0
  }
  if (player.magnetActive && now >= player.magnetEndTime) {
    player.magnetActive = false
    player.magnetEndTime = 0
  }
}

function checkSnakeCollision(hitter, victim) {
  const head = hitter.segments[0]
  if (!head) return -1
  const body = victim.segments
  for (let i = 1; i < body.length; i++) {
    if (dist(head, body[i]) < 0.4) return i
  }
  return -1
}

function computeReflection(head, body, hitIdx, direction, boosting) {
  const speed = boosting ? 15 : 8
  const step = speed * 0.05

  const prev = body[Math.max(0, hitIdx - 1)]
  const next = body[Math.min(body.length - 1, hitIdx + 1)]
  const tx = next.x - prev.x
  const ty = next.y - prev.y
  const tLen = Math.hypot(tx, ty)
  if (tLen < 0.001) {
    return { x: -Math.cos(direction) * step * 3.0, y: -Math.sin(direction) * step * 3.0 }
  }
  const nx = -ty / tLen
  const ny = tx / tLen

  const vx = Math.cos(direction) * step
  const vy = Math.sin(direction) * step

  const dot = vx * nx + vy * ny
  const rx = vx - 2 * dot * nx
  const ry = vy - 2 * dot * ny

  const factor = 3.0
  return { x: rx * factor, y: ry * factor }
}

function processLaser(shooter, roomState, now) {
  const ox = shooter.laserOriginX
  const oy = shooter.laserOriginY
  const dir = shooter.laserDirection
  const dx = Math.cos(dir)
  const dy = Math.sin(dir)
  const range = LASER_RANGE

  const targets = [...roomState.players.values()].filter(p => p.alive && p.id !== shooter.id && !p.phantomActive)

  const hits = []
  for (const target of targets) {
    if (!target.segments[0]) continue
    for (let i = 0; i < target.segments.length; i++) {
      const seg = target.segments[i]
      const tx = seg.x - ox
      const ty = seg.y - oy
      const t = tx * dx + ty * dy
      if (t < 0 || t > range) continue
      const cx = ox + dx * t
      const cy = oy + dy * t
      const d = Math.hypot(seg.x - cx, seg.y - cy)
      if (d < 0.5) {
        hits.push({ target, index: i, t })
        break
      }
    }
  }

  hits.sort((a, b) => a.t - b.t)

  for (const hit of hits) {
    if (!hit.target.alive) continue
    if (hit.index === 0) {
      const shieldResult = consumeShield(hit.target, now)
      if (shieldResult) {
        if (shieldResult === 'consumed') {
          roomState.shockwaves.push({ x: hit.target.segments[0].x, y: hit.target.segments[0].y, spawnTick: roomState.tickCount })
        }
        const head = hit.target.segments[0]
        if (head) {
          const push = computeReflection(head, hit.target.segments, 0, hit.target.direction, hit.target.boosting)
          hit.target.knockbackX += push.x
          hit.target.knockbackY += push.y
        }
      } else {
        for (const s of hit.target.segments) {
          roomState.foods.push({ x: s.x, y: s.y, type: FOOD_TYPES[0] })
        }
        hit.target.alive = false
        hit.target.segments = []
      }
    } else {
      const keepCount = hit.index
      if (keepCount < 1) continue
      const cutSegments = hit.target.segments.splice(keepCount)
      for (const s of cutSegments) {
        roomState.foods.push({ x: s.x, y: s.y, type: FOOD_TYPES[0] })
      }
      hit.target.growCounter = Math.max(0, keepCount - INITIAL_SEGMENTS)
      // Truncate path to match new shorter body
      const lastSeg = hit.target.segments[keepCount - 1]
      if (lastSeg) {
        let bestIdx = hit.target.path.length - 1
        let bestDist = Infinity
        for (let j = 0; j < hit.target.path.length; j++) {
          const d = Math.hypot(hit.target.path[j].x - lastSeg.x, hit.target.path[j].y - lastSeg.y)
          if (d < bestDist) { bestDist = d; bestIdx = j }
        }
        hit.target.path = hit.target.path.slice(0, bestIdx + 1)
      }
      updateBody(hit.target)
    }
  }
}

function collectItems(player, roomState, now) {
  const head = player.segments[0]
  if (!head) return

  // Food
  for (const f of roomState.foods) {
    if (dist(head, f) < 0.5) {
      const prevScore = player.score
      player.score += f.type.points
      player.growCounter += f.type.points
      roomState.foods = roomState.foods.filter(f2 => f2 !== f)

      if (Math.floor(player.score / 100) > Math.floor(prevScore / 100)) {
        player.shields++
      }
      break
    }
  }

  // Items
  for (const item of roomState.phantomItems) {
    if (dist(head, item) < 0.5) {
      roomState.phantomItems = roomState.phantomItems.filter(x => x !== item)
      player.phantomCharges++
    }
  }
  for (const item of roomState.shieldItems) {
    if (dist(head, item) < 0.5) {
      roomState.shieldItems = roomState.shieldItems.filter(x => x !== item)
      player.shields++
    }
  }
  for (const item of roomState.dietItems) {
    if (dist(head, item) < 0.5) {
      roomState.dietItems = roomState.dietItems.filter(x => x !== item)
      player.dietHeadEndTime = now + 3000
      const halfLen = Math.max(2, Math.ceil((INITIAL_SEGMENTS + player.growCounter) / 2))
      player.growCounter = Math.max(0, halfLen - INITIAL_SEGMENTS)
    }
  }
  for (const item of roomState.magnetItems) {
    if (dist(head, item) < 0.5) {
      roomState.magnetItems = roomState.magnetItems.filter(x => x !== item)
      player.magnetActive = true
      player.magnetEndTime = now + 5000
    }
  }
  for (const item of roomState.laserItems) {
    if (dist(head, item) < 0.5) {
      roomState.laserItems = roomState.laserItems.filter(x => x !== item)
      player.laserCharges++
    }
  }

  // Magnet effect
  if (player.magnetActive) {
    const inRange = (item) => Math.hypot(item.x - head.x, item.y - head.y) <= 3
    for (const f of roomState.foods) {
      if (inRange(f)) {
        player.score += f.type.points
        player.growCounter += f.type.points
        roomState.foods = roomState.foods.filter(x => x !== f)
      }
    }
    for (const item of roomState.phantomItems) {
      if (inRange(item)) {
        roomState.phantomItems = roomState.phantomItems.filter(x => x !== item)
        player.phantomCharges++
      }
    }
    for (const item of roomState.shieldItems) {
      if (inRange(item)) {
        roomState.shieldItems = roomState.shieldItems.filter(x => x !== item)
        player.shields++
      }
    }
    for (const item of roomState.dietItems) {
      if (inRange(item)) {
        roomState.dietItems = roomState.dietItems.filter(x => x !== item)
        player.dietHeadEndTime = now + 3000
        const halfLen = Math.max(2, Math.ceil((INITIAL_SEGMENTS + player.growCounter) / 2))
        player.growCounter = Math.max(0, halfLen - INITIAL_SEGMENTS)
      }
    }
    for (const item of roomState.laserItems) {
      if (inRange(item)) {
        roomState.laserItems = roomState.laserItems.filter(x => x !== item)
        player.laserCharges++
      }
    }
  }
}

function maintainFood(roomState, playerCount) {
  const targetCount = Math.floor(0.005 * Math.PI * roomState.worldRadius * roomState.worldRadius)
  const toSpawn = Math.max(0, targetCount - roomState.foods.length)
  if (toSpawn <= 0) return
  for (let i = 0; i < Math.min(toSpawn, 10); i++) {
    const pos = randomPointInCircle(roomState.worldRadius * 0.9)
    const type = FOOD_TYPES[Math.floor(Math.random() * FOOD_TYPES.length)]
    roomState.foods.push({ x: pos.x, y: pos.y, type })
  }
}

function maintainSkillItems(roomState) {
  const targetTotal = Math.floor(0.001 * Math.PI * roomState.worldRadius * roomState.worldRadius)
  if (targetTotal <= 0) return
  const phantomTarget = Math.floor(targetTotal * 30 / 100)
  const shieldTarget = Math.floor(targetTotal * 5 / 100)
  const magnetTarget = Math.floor(targetTotal * 20 / 100)
  const dietTarget = Math.floor(targetTotal * 15 / 100)
  const laserTarget = Math.floor(targetTotal * 30 / 100)
  const maxSpawn = 8
  const r = roomState.worldRadius * 0.85

  for (let i = roomState.phantomItems.length; i < phantomTarget && i < roomState.phantomItems.length + maxSpawn; i++) {
    const pos = randomPointInCircle(r)
    roomState.phantomItems.push({ x: pos.x, y: pos.y, spawnTick: roomState.tickCount })
  }
  for (let i = roomState.shieldItems.length; i < shieldTarget && i < roomState.shieldItems.length + maxSpawn; i++) {
    const pos = randomPointInCircle(r)
    roomState.shieldItems.push({ x: pos.x, y: pos.y, spawnTick: roomState.tickCount })
  }
  for (let i = roomState.magnetItems.length; i < magnetTarget && i < roomState.magnetItems.length + maxSpawn; i++) {
    const pos = randomPointInCircle(r)
    roomState.magnetItems.push({ x: pos.x, y: pos.y, spawnTick: roomState.tickCount })
  }
  for (let i = roomState.dietItems.length; i < dietTarget && i < roomState.dietItems.length + maxSpawn; i++) {
    const pos = randomPointInCircle(r)
    roomState.dietItems.push({ x: pos.x, y: pos.y, spawnTick: roomState.tickCount })
  }
  for (let i = roomState.laserItems.length; i < laserTarget && i < roomState.laserItems.length + maxSpawn; i++) {
    const pos = randomPointInCircle(r)
    roomState.laserItems.push({ x: pos.x, y: pos.y, spawnTick: roomState.tickCount })
  }
}

function spawnItem(roomState, type, now) {
  const pos = randomPointInCircle(roomState.worldRadius * 0.85)
  const item = { x: pos.x, y: pos.y, spawnTick: roomState.tickCount }
  if (type === 'phantom') roomState.phantomItems.push(item)
  else if (type === 'shield') roomState.shieldItems.push(item)
  else if (type === 'diet') roomState.dietItems.push(item)
  else if (type === 'magnet') roomState.magnetItems.push(item)
  else if (type === 'laser') roomState.laserItems.push(item)
}

export function getBroadcastState(roomState) {
  const players = {}
  for (const [id, p] of roomState.players) {
    players[id] = {
      id: p.id,
      username: p.username,
      segments: p.segments,
      direction: p.direction,
      score: p.score,
      shields: p.shields,
      boosting: p.boosting,
      alive: p.alive,
      phantomActive: p.phantomActive,
      phantomCharges: p.phantomCharges,
      phantomEndTime: p.phantomEndTime,
      dietHeadEndTime: p.dietHeadEndTime,
      magnetActive: p.magnetActive,
      magnetEndTime: p.magnetEndTime,
      invincibleEndTime: p.invincibleEndTime,
      knockbackX: p.knockbackX,
      knockbackY: p.knockbackY,
      laserCharges: p.laserCharges,
      firingLaser: p.firingLaser,
      laserDirection: p.laserDirection,
      laserOriginX: p.laserOriginX,
      laserOriginY: p.laserOriginY,
    }
  }
  return {
    players,
    foods: roomState.foods,
    phantomItems: roomState.phantomItems,
    shieldItems: roomState.shieldItems,
    dietItems: roomState.dietItems,
    magnetItems: roomState.magnetItems,
    laserItems: roomState.laserItems,
    shockwaves: roomState.shockwaves,
    worldRadius: roomState.worldRadius,
    status: roomState.status,
    tickCount: roomState.tickCount,
  }
}
