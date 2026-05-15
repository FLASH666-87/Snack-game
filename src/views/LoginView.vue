<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const router = useRouter()

onMounted(async () => {
  await auth.ensureReady()
  if (auth.currentUser) {
    router.replace('/game')
  }
})

async function loginGoogle() {
  await auth.loginWithGoogle()
  if (auth.currentUser) {
    router.replace('/game')
  }
}
</script>

<template>
  <div class="login-wrapper">
    <div class="login-card">
      <h1>🐍 貪食蛇</h1>
      <h2>登入</h2>

      <p v-if="auth.error" class="error">{{ auth.error }}</p>

      <button class="google-btn" @click="loginGoogle">
        <span class="g-icon">G</span>
        使用 Google 登入
      </button>

      <p class="lb-link" @click="router.push('/leaderboard')">🏆 排行榜</p>
    </div>
  </div>
</template>

<style scoped>
.login-wrapper {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #1a1a2e;
  font-family: 'Segoe UI', sans-serif;
}

.login-card {
  background: #16213e;
  padding: 40px 32px;
  border-radius: 16px;
  width: 340px;
  text-align: center;
  color: #fff;
}

.login-card h1 {
  margin: 0 0 4px;
  font-size: 28px;
}

.login-card h2 {
  margin: 0 0 24px;
  font-size: 18px;
  font-weight: 400;
  opacity: 0.7;
}

.error {
  color: #ff6b6b;
  font-size: 14px;
  margin: 0 0 12px;
}

.google-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  padding: 12px 24px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  background: #fff;
  color: #333;
  font-size: 16px;
  cursor: pointer;
  transition: background 0.15s;
}

.google-btn:hover {
  background: #f0f0f0;
}

.g-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #4285f4;
  color: #fff;
  font-weight: 700;
  font-size: 14px;
}

.lb-link {
  margin: 16px 0 0;
  font-size: 14px;
  opacity: 0.6;
  cursor: pointer;
  transition: opacity 0.15s;
}

.lb-link:hover {
  opacity: 1;
}
</style>
