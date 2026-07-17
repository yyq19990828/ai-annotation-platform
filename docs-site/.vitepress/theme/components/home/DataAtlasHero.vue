<script setup lang="ts">
import { withBase } from "vitepress";
// 静态导入让 Vite 处理资源哈希与 base 前缀，子路径部署（DOCS_BASE）也正确。
import ocrInferenceUrl from "../../../../user-guide/images/workbench/ocr-real-scene.gif";

const getStartedHref = withBase("/user-guide/getting-started");

/** 复用现有 VitePress local search：优先点击导航栏搜索按钮，回退到 ⌘K 快捷键。 */
function openSearch(): void {
  const btn = document.querySelector<HTMLElement>(
    ".VPNavBarSearch button, .VPNavBarSearchButton, button.DocSearch-Button",
  );
  if (btn) {
    btn.click();
    return;
  }
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "k", metaKey: true, ctrlKey: true }),
  );
}
</script>

<template>
  <header class="hero">
    <div class="hero-grid" aria-hidden="true"></div>

    <div class="hero-copy">
      <div class="overline">Open source · Human in the loop</div>
      <h1>THE DATA<br />THAT TRAINS<br /><em>INTELLIGENCE</em></h1>
      <p class="hero-desc">
        把图像、视频和点云，从复杂原始数据转化为可审核、可追踪、可复用的训练资产。
      </p>
      <div class="hero-actions">
        <a class="hero-btn magnetic" :href="getStartedHref">
          打开使用文档 <span aria-hidden="true">↗</span>
        </a>
        <button class="search-line" type="button" @click="openSearch">
          <span>SEARCH THE KNOWLEDGE BASE</span><b>⌘ K</b>
        </button>
      </div>
    </div>

    <div class="hero-art">
      <svg
        class="hero-atlas"
        viewBox="0 0 700 760"
        aria-hidden="true"
        focusable="false"
      >
        <path
          class="orbit"
          d="M78 360C130 94 490 30 638 266S527 692 258 642 15 481 78 360Z"
        />
        <path
          class="orbit"
          d="M126 550C46 308 244 67 493 126S718 483 515 636 188 708 126 550Z"
        />
        <path
          class="orbit"
          d="M89 225C244 48 586 117 633 380S368 726 150 565-24 352 89 225Z"
        />
        <g class="ray">
          <path
            d="M350 380 74 38M350 380 128 17M350 380 188 7M350 380 247 0M350 380 309 2M350 380 371 0M350 380 438 8M350 380 502 21M350 380 561 48M350 380 617 89M350 380 662 142M350 380 688 206M350 380 700 278M350 380 697 350M350 380 690 426M350 380 670 497M350 380 635 559M350 380 589 616M350 380 530 663M350 380 464 701M350 380 393 728M350 380 321 739M350 380 250 728M350 380 181 705M350 380 119 666M350 380 68 613M350 380 29 550M350 380 8 480M350 380 0 407"
          />
        </g>
        <rect class="frame" x="118" y="188" width="145" height="116" />
        <rect class="frame" x="469" y="440" width="112" height="142" />
        <circle class="node" cx="118" cy="188" r="5" />
        <circle class="node" cx="580" cy="581" r="5" />
      </svg>

      <div class="art-label" aria-hidden="true">
        ANNOTATION ATLAS · LIVE SIGNALS
      </div>

      <div class="hero-figure">
        <img :src="ocrInferenceUrl" alt="真实 RapidOCR 当前题推理生成文本候选" />
        <i class="bbox a" data-label="ocr candidate" aria-hidden="true"></i>
        <i class="bbox b" data-label="text result" aria-hidden="true"></i>
      </div>
    </div>

    <div class="hero-index" aria-hidden="true">01 / PLATFORM OVERVIEW</div>
  </header>
</template>
