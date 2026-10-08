<script setup lang="ts">
import { ArrowUpRight } from "@lucide/vue";
import { brand, history, principles } from "../brand";
</script>

<template>
  <section class="container about-intro">
    <div>
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
    <figure class="about-photo">
      <img
        src="/images/舒适生活.png"
        alt="自然光下的舒适客厅，禾序品牌生活场景示意"
        width="1536"
        height="1024"
      />
      <figcaption>让生活回到舒服的节奏。</figcaption>
    </figure>
  </section>
  <section class="brand-story">
    <div class="container section">
      <div class="section-heading">
        <div>
          <p class="eyebrow">我们的坚持</p>
          <h2>从日常出发，也回到日常。</h2>
        </div>
      </div>
      <div class="about-values">
        <article v-for="item in principles" :key="item.number">
          <span>{{ item.number }}</span>
          <h3>{{ item.title }}</h3>
          <p>{{ item.text }}</p>
        </article>
      </div>
    </div>
  </section>
  <section class="container section history-section">
    <div class="section-heading">
      <div>
        <p class="eyebrow">品牌故事</p>
        <h2>一步一步，让舒适更清晰。</h2>
        <p>以下历程为禾序虚拟品牌设定，用于学习与官网内容演示。</p>
      </div>
    </div>
    <div class="history-list">
      <article v-for="item in history" :key="item.time">
        <span>{{ item.time }}</span>
        <div>
          <h3>{{ item.title }}</h3>
          <p>{{ item.text }}</p>
        </div>
      </article>
    </div>
    <aside class="honesty-note">
      <h3>关于这个品牌</h3>
      <p>
        禾序是本项目的虚拟品牌。本站产品目录参考美的和小米的公开产品资料，不宣称实际生产、授权代理、认证或商业合作；图片中的生活空间为生成的场景示意。
      </p>
    </aside>
  </section>
</template>
