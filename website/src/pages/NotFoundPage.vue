<script setup lang="ts">
import { ArrowLeft } from "@lucide/vue";
</script>
<template>
  <section class="container not-found">
    <p class="eyebrow">404</p>
    <h1>这一页，暂时不在这里。</h1>
    <p>可以返回首页，或者到产品中心继续浏览。</p>
    <RouterLink to="/" class="button button-primary"
      ><ArrowLeft :size="18" />返回首页</RouterLink
    >
  </section>
</template>
