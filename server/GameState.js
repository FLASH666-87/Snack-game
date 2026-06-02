export const SEGMENT_SPACING = 0.3
export const INITIAL_SEGMENTS = 12
export const ROTATION_SPEED = 0.60
export const WORLD_GROWTH_PER_SCORE = 0.15
export const MIN_WORLD_RADIUS = 100

export const FOOD_TYPES = [
  { color: '#FF0000', points: 1 },
  { color: '#FF7F00', points: 2 },
  { color: '#FFFF00', points: 3 },
  { color: '#00FF00', points: 4 },
  { color: '#0000FF', points: 5 },
  { color: '#4B0082', points: 6 },
  { color: '#8B00FF', points: 7 },
]

export const PHANTOM_LIFETIME = 10000
export const SKILL_TYPES_COUNT = 5
export const LASER_RANGE = 50

export function createInitialSnake() {
  const totalSegs = INITIAL_SEGMENTS
  const totalLen = totalSegs * SEGMENT_SPACING
  const path = []
  for (let d = 0; d <= totalLen + 0.5; d += 0.05) {
    path.push({ x: -d, y: 0 })
  }
  path.reverse()

  const segments = [{ x: 0, y: 0 }]
  return { path, segments }
}

export function createPlayerState(id, username) {
  const { path, segments } = createInitialSnake()
  return {
    id,
    username,
    segments,
    path,
    direction: 0,
    targetDirection: 0,
    score: 0,
    shields: 0,
    boosting: false,
    growCounter: 0,
    alive: true,
    invincibleEndTime: 0,
    phantomActive: false,
    phantomEndTime: 0,
    phantomCharges: 0,
    dietHeadEndTime: 0,
    magnetActive: false,
    magnetEndTime: 0,
    knockbackX: 0,
    knockbackY: 0,
    laserCharges: 0,
    firingLaser: false,
    laserDirection: 0,
    laserOriginX: 0,
    laserOriginY: 0,
  }
}

export function createRoomState(roomCode) {
  return {
    roomCode,
    players: new Map(),
    foods: [],
    phantomItems: [],
    shieldItems: [],
    dietItems: [],
    magnetItems: [],
    laserItems: [],
    shockwaves: [],
    worldRadius: MIN_WORLD_RADIUS,
    status: 'waiting',
    tickCount: 0,
    maxPlayers: 6,
  }
}
