<script setup lang="ts">
import { ArrowRight, ArrowUpRight, BookOpen, Headphones } from "@lucide/vue";
import { brand, principles } from "../brand";
import { chat } from "../chat/service";
import { useProducts } from "../useProducts";
import ProductCard from "../components/ProductCard.vue";
import CatalogState from "../components/CatalogState.vue";
const { products, loading, error, reload } = useProducts();
</script>

<template>
  <section class="home-hero">
    <div class="container hero-layout">
      <div class="hero-copy">
        <p class="eyebrow">禾序智能 · 家庭电器与生活服务</p>
        <h1>让日常，<br /><span>井然舒适。</span></h1>
        <p class="hero-description">
          家的舒适，藏在平常的细节里。<br />让温度刚好，让空气清新，让选择更简单。
        </p>
        <div class="hero-actions">
          <RouterLink to="/products" class="button button-cream"
            >探索产品 <ArrowRight :size="18" /></RouterLink
          ><RouterLink to="/about" class="hero-secondary"
            >认识禾序 <ArrowUpRight :size="17"
          /></RouterLink>
        </div>
        <p class="hero-footnote">温度 · 空气 · 舒适日常</p>
      </div>
      <figure class="hero-photo">
        <img
          src="/images/舒适生活.png"
          alt="暖白与木色的客厅，窗边自然光与日常生活物件"
          width="1536"
          height="1024"
          fetchpriority="high"
        />
        <figcaption>把舒适，留给生活。<span>品牌生活场景示意</span></figcaption>
      </figure>
    </div>
  </section>
  <section class="container section">
    <div class="section-heading">
      <div>
        <p class="eyebrow">从家的需要开始</p>
        <h2>好好生活，慢慢挑选。</h2>
        <p>从取暖到空气，找到适合你家的一款。</p>
      </div>
      <RouterLink to="/products" class="text-link"
        >全部产品 <ArrowRight :size="18"
      /></RouterLink>
    </div>
    <CatalogState
      :loading="loading"
      :error="error"
      :empty="!products.length"
      @retry="reload"
    />
    <div v-if="!loading && !error" class="product-grid">
      <ProductCard
        v-for="product in products.slice(0, 4)"
        :key="product.id"
        :product="product"
      />
    </div>
  </section>
  <section class="brand-story">
    <div class="container story-layout">
      <div>
        <p class="eyebrow">关于禾序</p>
        <h2>科技的意义，<br />是让生活少一点费心。</h2>
        <p class="story-intro">{{ brand.introduction }}</p>
        <RouterLink to="/about" class="text-link"
          >了解我们的故事 <ArrowUpRight :size="18"
        /></RouterLink>
      </div>
      <div class="principles">
        <article v-for="item in principles" :key="item.number">
          <span>{{ item.number }}</span>
          <div>
            <h3>{{ item.title }}</h3>
            <p>{{ item.text }}</p>
          </div>
        </article>
      </div>
    </div>
  </section>
  <section class="container section service-section">
    <div class="section-heading">
      <div>
        <p class="eyebrow">使用与服务</p>
        <h2>需要帮助时，简单一点。</h2>
      </div>
    </div>
    <div class="service-links">
      <RouterLink to="/support#documents"
        ><BookOpen :size="26" />
        <div>
          <h3>查阅使用资料</h3>
          <p>选购、使用、维护与常见问题。</p>
        </div>
        <ArrowUpRight :size="20" /></RouterLink
      ><button type="button" @click="chat.openWidget()">
        <Headphones :size="26" />
        <div>
          <h3>咨询在线助手</h3>
          <p>产品信息与使用问题，为你梳理清楚。</p>
        </div>
        <ArrowUpRight :size="20" />
      </button>
    </div>
  </section>
</template>
