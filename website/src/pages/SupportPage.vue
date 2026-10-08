<script setup lang="ts">
import { ArrowUpRight, Download, FileText } from "@lucide/vue";
import { chat } from "../chat/service";
import intro from "../../资料/品牌介绍.md?url";
import history from "../../资料/品牌历史.md?url";
import about from "../../资料/关于我们.md?url";
import catalog from "../../资料/产品选购与规格说明.md?url";
import heating from "../../资料/取暖产品使用指南.md?url";
import air from "../../资料/空气产品使用指南.md?url";
import service from "../../资料/服务支持与常见问题.md?url";
const documents = [
  { name: "品牌介绍", description: "品牌定位、名称与理念", url: intro },
  { name: "品牌历史", description: "虚拟品牌的发展故事", url: history },
  { name: "关于我们", description: "公司介绍与服务范围", url: about },
  {
    name: "产品选购与规格说明",
    description: "四款产品的目录快照与信息边界",
    url: catalog,
  },
  {
    name: "取暖产品使用指南",
    description: "使用前检查、日常维护与问题排查",
    url: heating,
  },
  {
    name: "空气产品使用指南",
    description: "净化器与新风机的使用和维护",
    url: air,
  },
  {
    name: "服务支持与常见问题",
    description: "咨询、售后与资料不足时的处理",
    url: service,
  },
];
const faq = [
  {
    question: "网站里的产品是禾序自己生产的吗？",
    answer:
      "不是。禾序是虚拟品牌，当前目录展示美的和小米的产品资料，用于学习产品信息与客服服务。没有授权代理或品牌合作关系。",
  },
  {
    question: "页面显示的价格就是购买价格吗？",
    answer:
      "不是。页面展示目录中的参考价格或价格说明，不提供实时促销、库存和交易服务。购买前请查看对应产品的官方渠道。",
  },
  {
    question: "如何选择取暖或空气产品？",
    answer:
      "先确认房间大小、使用环境和安装条件，再对照具体型号的官方规格。功率、适用面积和 CADR 不能互相替代，也不能直接推算承诺效果。",
  },
  {
    question: "这里能办理维修、退款或查询订单吗？",
    answer:
      "当前网站可以提供资料查询和步骤说明，不能实际办理订单、退款或维修。具体处理请联系原品牌或购买渠道的官方服务。",
  },
  {
    question: "这些资料是正式的产品说明书吗？",
    answer:
      "不是。这里提供学习项目整理的 Markdown 资料，不替代产品随附的说明书。涉及安全、安装、联网和售后条款时，应以实际型号的官方文件为准。",
  },
];
</script>

<template>
  <section class="container support-page">
    <div class="page-heading">
      <p class="eyebrow">服务支持</p>
      <h1>有疑问，慢慢说清楚。</h1>
      <p>从认识产品，到日常使用，找到需要的资料与帮助。</p>
    </div>
    <div class="support-intro">
      <div>
        <h2>先了解，再开始使用。</h2>
        <p>
          确认型号、使用环境与安装条件。涉及电气安全和维修时，优先查阅官方说明书，必要时联系原品牌服务。
        </p>
      </div>
      <button
        type="button"
        @click="chat.openWidget()"
        class="button button-primary"
      >
        咨询在线助手 <ArrowUpRight :size="18" />
      </button>
    </div>
    <section id="documents" class="documents-section">
      <div class="section-heading">
        <div>
          <p class="eyebrow">中文资料</p>
          <h2>需要的信息，在这里。</h2>
          <p>Markdown 格式，可下载阅读或后续导入知识库。</p>
        </div>
      </div>
      <div class="document-list">
        <a
          v-for="doc in documents"
          :key="doc.name"
          :href="doc.url"
          :download="`${doc.name}.md`"
          ><FileText :size="22" />
          <div>
            <h3>{{ doc.name }}</h3>
            <p>{{ doc.description }}</p>
          </div>
          <span>MD <Download :size="18" /></span
        ></a>
      </div>
    </section>
    <section class="faq-section">
      <div class="section-heading">
        <div>
          <p class="eyebrow">常见问题</p>
          <h2>把常见疑问，先讲明白。</h2>
        </div>
      </div>
      <details v-for="item in faq" :key="item.question">
        <summary>{{ item.question }}<span aria-hidden="true">＋</span></summary>
        <p>{{ item.answer }}</p>
      </details>
    </section>
  </section>
</template>
