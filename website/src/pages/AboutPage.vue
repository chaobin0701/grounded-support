<script setup lang="ts">
import { ArrowUpRight } from "@lucide/vue";
import { brand, history, principles } from "../brand";
</script>

<template>
  <section class="container about-intro">
    <div v-reveal>
      <p class="eyebrow">关于我们</p>
      <h1>禾，是生活的生长。<br />序，是恰好的秩序。</h1>
      <p>{{ brand.introduction }}</p>
      <p>
        禾序智能科技有限公司，以家庭生活为出发点，希望让复杂的产品信息变得清楚，让需要帮助的时刻更从容。
      </p>
      <RouterLink to="/products" class="text-link"
        >了解产品 <ArrowUpRight :size="18"
      /></RouterLink>
    </div>
    <figure v-reveal="{ delay: 0.12, distance: 14, duration: 0.85 }" class="about-photo">
      <img
        src="/images/舒适生活.png"
        alt="自然光下的舒适客厅，禾序品牌生活场景示意"
        width="1536"
        height="1024"
      />
    </figure>
  </section>
  <section class="brand-story">
    <div class="container section">
      <div v-reveal class="section-heading">
        <div>
          <p class="eyebrow">我们的坚持</p>
          <h2>从日常出发，也回到日常。</h2>
        </div>
      </div>
      <div class="about-values">
        <article v-for="(item, index) in principles" :key="item.number" v-reveal="{ delay: index * 0.06 }">
          <span>{{ item.number }}</span>
          <h3>{{ item.title }}</h3>
          <p>{{ item.text }}</p>
        </article>
      </div>
    </div>
  </section>
  <section class="container section history-section">
    <div v-reveal class="section-heading">
      <div>
        <p class="eyebrow">品牌故事</p>
        <h2>一步一步，让舒适更清晰。</h2>
      </div>
    </div>
    <div class="history-list">
      <article v-for="(item, index) in history" :key="item.time" v-reveal="{ delay: (index % 3) * 0.06 }">
        <span>{{ item.time }}</span>
        <div>
          <h3>{{ item.title }}</h3>
          <p>{{ item.text }}</p>
        </div>
      </article>
    </div>
  </section>
</template>
