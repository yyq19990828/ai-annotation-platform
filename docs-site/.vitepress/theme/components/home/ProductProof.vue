<script setup lang="ts">
import workbenchUrl from "../../../../user-guide/images/workbench/layout-overview.png";
</script>

<template>
  <section class="proof" id="proof">
    <span class="section-no">02 / PRODUCT PROOF</span>
    <div class="proof-head reveal">
      <h2>REAL WORK.<br />REAL INTERFACE.</h2>
      <p class="proof-intro">
        高级感不来自虚构的仪表盘，而来自真实产品、清晰的操作边界，以及每个数据决策都可追溯的工作流。
      </p>
    </div>
    <div class="screen-stage reveal">
      <div class="proof-screen">
        <img :src="workbenchUrl" alt="AI 标注平台工作台" />
        <div class="screen-meta" aria-hidden="true">
          <span>ANNOTATION WORKBENCH / PRODUCTION UI</span>
          <span>IMAGE · VIDEO · POINT CLOUD</span>
        </div>
      </div>
      <div class="screen-stamp" aria-hidden="true">HUMAN<br />IN THE<br />LOOP</div>
    </div>
  </section>
</template>
