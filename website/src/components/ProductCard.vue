<script setup lang="ts">
import { ArrowUpRight } from "@lucide/vue";
import ProductImage from "./ProductImage.vue";
import type { Product } from "../catalog";
defineProps<{ product: Product }>();
</script>

<template>
  <RouterLink
    :to="`/products/${encodeURIComponent(product.id)}`"
    class="product-card"
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
</template>
