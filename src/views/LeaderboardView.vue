<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useScoreStore } from '../stores/score'
import { useAuthStore } from '../stores/auth'

const scoreStore = useScoreStore()
const auth = useAuthStore()
const router = useRouter()

onMounted(() => scoreStore.refresh())

function goBack() {
  if (auth.currentUser) {
    router.replace('/game')
  } else {
    router.replace('/login')
  }
}
</script>

<template>
  <div class="lb-wrapper">
    <div class="lb-card">
      <h1>🏆 排行榜</h1>

      <div class="table-wrap">
        <table v-if="scoreStore.leaderboard.length > 0">
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
        <p v-else class="empty">尚無紀錄</p>
      </div>

      <button class="btn" @click="goBack">返回</button>
    </div>
  </div>
</template>

<style scoped>
.lb-wrapper {
  position: fixed; inset: 0;
  display: flex; align-items: center; justify-content: center;
  background: #1a1a2e; font-family: 'Segoe UI', sans-serif;
}
.lb-card {
  background: #16213e; padding: 32px; border-radius: 16px;
  width: 400px; max-width: 90vw; text-align: center; color: #fff;
}
.lb-card h1 { margin: 0 0 20px; font-size: 28px; }
.table-wrap { max-height: 360px; overflow-y: auto; margin-bottom: 20px; }
table { width: 100%; border-collapse: collapse; }
th { font-size: 14px; opacity: 0.6; padding: 8px 4px; border-bottom: 1px solid rgba(255,255,255,0.1); }
td { padding: 10px 4px; font-size: 16px; border-bottom: 1px solid rgba(255,255,255,0.05); }
tr.me td { color: #4caf50; font-weight: 700; }
.empty { opacity: 0.4; font-size: 18px; margin: 40px 0; }
.btn {
  padding: 10px 32px; border: none; border-radius: 8px;
  background: #4caf50; color: #fff; font-size: 16px; cursor: pointer;
}
.btn:hover { background: #43a047; }
</style>
