import { ref } from 'vue'
import { defineStore } from 'pinia'
import { db } from '../firebase'
import {
  collection,
  query,
  orderBy,
  getDocs,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore'

export interface ScoreEntry {
  id: string
  username: string
  highScore: number
}

export const useScoreStore = defineStore('score', () => {
  const leaderboard = ref<ScoreEntry[]>([])

  async function refresh() {
    try {
      const q = query(collection(db, 'scores'), orderBy('highScore', 'desc'))
      const snap = await getDocs(q)
      leaderboard.value = snap.docs.map(d => ({
        id: d.id,
        username: d.data().username,
        highScore: d.data().highScore,
      }))
    } catch {
      // ignore
    }
  }

  async function saveScore(userId: string, displayName: string, score: number) {
    if (!userId) return
    try {
      const ref = doc(db, 'scores', userId)
      const snap = await getDoc(ref)
      if (snap.exists() && score <= snap.data().highScore) return
      await setDoc(ref, {
        username: displayName,
        highScore: score,
        updatedAt: serverTimestamp(),
      })
    } catch {
      // ignore
    }
    await refresh()
  }

  return { leaderboard, refresh, saveScore }
})
