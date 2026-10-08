<script setup lang="ts">
import { ArrowUpRight, MessageCircle } from "@lucide/vue";
import ProductImage from "./ProductImage.vue";
import type { Product } from "../catalog";
import { chat } from "../chat/service";
defineProps<{ product: Product }>();
</script>

<template>
  <article class="product-card">
  <RouterLink
    :to="`/products/${encodeURIComponent(product.id)}`"
    class="product-card-link"
  >
    <ProductImage :src="product.imageUrl" :alt="product.name" />
    <div class="product-card-content">
      <span class="eyebrow"
        >{{ product.category }} ·
        {{
          product.brand === "Midea"
            ? "美的"
            : product.brand === "Xiaomi"
              ? "小米"
              : product.brand
        }}</span
      >
      <h3>{{ product.name }}</h3>
      <p>{{ product.summary }}</p>
      <div class="product-card-bottom">
        <span>{{ product.suggestedPrice || "价格以官方渠道为准" }}</span
        ><span class="card-arrow" aria-hidden="true"
          ><ArrowUpRight :size="20"
        /></span>
      </div>
    </div>
  </RouterLink>
  <button type="button" class="product-card-consult" :disabled="chat.busy() || chat.state.unresolved"
    :aria-label="`咨询产品：${product.name}`" @click="chat.openWidget({ id: product.id, name: product.name })">
    <MessageCircle :size="15" />咨询产品
  </button>
  </article>
</template>
