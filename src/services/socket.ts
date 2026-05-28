import { io, Socket } from 'socket.io-client'

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || ''

let socket: Socket | null = null
let reconnectAttempts = 0

export function connectSocket(): Socket {
  if (socket?.connected) return socket
  if (socket) {
    socket.removeAllListeners()
    socket.disconnect()
    socket = null
  }
  reconnectAttempts = 0
  socket = io(SOCKET_URL, {
    autoConnect: true,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 20,
  })
  socket.on('reconnect_attempt', () => {
    reconnectAttempts++
  })
  return socket
}

export function getSocket(): Socket | null {
  return socket
}

export function getReconnectAttempts(): number {
  return reconnectAttempts
}

export function disconnectSocket() {
  if (socket) {
    socket.removeAllListeners()
    socket.disconnect()
    socket = null
  }
  reconnectAttempts = 0
}
