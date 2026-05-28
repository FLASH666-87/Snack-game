import { ref } from 'vue'
import { defineStore } from 'pinia'
import { auth, googleProvider } from '../firebase'
import { signInWithPopup, signOut, onAuthStateChanged, type User } from 'firebase/auth'

export const useAuthStore = defineStore('auth', () => {
  const currentUser = ref<User | null>(null)
  const error = ref('')

  let resolveReady!: () => void
  const ready = new Promise<void>(resolve => {
    resolveReady = resolve
  })

  onAuthStateChanged(auth, (user) => {
    currentUser.value = user
    resolveReady()
  })

  async function ensureReady() {
    await ready
  }

  async function loginWithGoogle() {
    error.value = ''
    try {
      await signInWithPopup(auth, googleProvider)
    } catch (err) {
      if ((err as { code?: string }).code !== 'auth/popup-closed-by-user') {
        error.value = 'Google 登入失敗'
      }
    }
  }

  function logout() {
    signOut(auth)
  }

  return { currentUser, error, loginWithGoogle, logout, ensureReady }
})
