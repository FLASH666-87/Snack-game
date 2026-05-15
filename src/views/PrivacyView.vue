<script setup lang="ts">
import { useRouter } from 'vue-router'
const router = useRouter()
</script>

<template>
  <div class="privacy-wrapper">
    <div class="privacy-card">
      <h1>隱私權政策</h1>
      <p class="updated">更新日期：2026 年 5 月</p>

      <section>
        <h2>1. 收集的資料</h2>
        <p>本遊戲使用 Google 登入時，會取得您的 Google 顯示名稱和電子郵件地址。遊戲過程中的最高分數也會被記錄。</p>
      </section>

      <section>
        <h2>2. 資料用途</h2>
        <p>您的名稱和分數僅用於顯示在排行榜上，供所有玩家查看。</p>
      </section>

      <section>
        <h2>3. 資料儲存</h2>
        <p>資料儲存於 Firebase 雲端服務，僅供排行榜功能使用。</p>
      </section>

      <section>
        <h2>4. 資料分享</h2>
        <p>我們不會將您的個人資料分享、販售或提供給任何第三方。</p>
      </section>

      <section>
        <h2>5. 資料刪除</h2>
        <p>如需刪除您的資料，請透過下方聯絡方式與我們聯繫。</p>
      </section>

      <section>
        <h2>6. 聯絡方式</h2>
        <p>如有任何隱私權相關問題，請聯絡：ielp210855@gmail.com</p>
      </section>

      <button class="btn" @click="router.push('/login')">返回</button>
    </div>
  </div>
</template>

<style scoped>
.privacy-wrapper {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #1a1a2e;
  font-family: 'Segoe UI', sans-serif;
  overflow-y: auto;
}

.privacy-card {
  background: #16213e;
  padding: 40px 32px;
  border-radius: 16px;
  width: 600px;
  max-width: 90vw;
  color: #fff;
  margin: 40px 0;
}

.privacy-card h1 {
  margin: 0 0 4px;
  font-size: 28px;
}

.updated {
  opacity: 0.5;
  font-size: 14px;
  margin: 0 0 24px;
}

section {
  margin-bottom: 20px;
}

section h2 {
  font-size: 18px;
  margin: 0 0 8px;
}

section p {
  font-size: 15px;
  line-height: 1.6;
  opacity: 0.85;
  margin: 0;
}

.btn {
  display: block;
  margin: 32px auto 0;
  padding: 12px 36px;
  font-size: 16px;
  border: none;
  border-radius: 8px;
  background: #4caf50;
  color: #fff;
  cursor: pointer;
}

.btn:hover {
  background: #43a047;
}
</style>
