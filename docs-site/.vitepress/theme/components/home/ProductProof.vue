<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { withBase } from "vitepress";
import ocrUrl from "../../../../user-guide/images/workbench/ocr-real-scene.png";
import prelabelUrl from "../../../../user-guide/images/projects/ai-pre-config-panel.png";
import modelMarketUrl from "../../../../user-guide/images/superadmin/model-market/list.png";

type ProofScene = {
  no: string;
  kicker: string;
  title: string;
  desc: string;
  meta: string;
  href: string;
  kind: "video" | "image";
  src: string;
  poster?: string;
  alt: string;
};

const scenes: ProofScene[] = [
  {
    no: "01",
    kicker: "INTERACTIVE / SAM3",
    title: "框出意图，确认结果",
    desc: "Magic Box 把粗框交给已绑定的 SAM3，返回候选后由标注员确认类别。",
    meta: "LIVE SAM3 · MAGIC BOX · HUMAN ACCEPT",
    href: withBase("/user-guide/workbench/sam-tool"),
    kind: "video",
    src: withBase("/home/ai-assisted-annotation.webm"),
    poster: withBase("/home/ai-assisted-annotation-poster.webp"),
    alt: "真实道路图中使用 SAM3 Magic Box 生成车辆候选并由人工确认类别",
  },
  {
    no: "02",
    kicker: "DOCUMENT / OCR",
    title: "识别之后，继续修正",
    desc: "真实文档图进入当前题推理，模型版本、参数与结果和任务上下文一起保留。",
    meta: "RAPIDOCR · CURRENT TASK · TRACEABLE PARAMS",
    href: withBase("/user-guide/projects/ai-preannotate"),
    kind: "image",
    src: ocrUrl,
    alt: "OCR 真实场景工作台及当前任务 AI 参数面板",
  },
  {
    no: "03",
    kicker: "BATCH / PRE-LABEL",
    title: "批量任务先由模型处理",
    desc: "在项目里配置模型、变体与阈值，让大批数据先生成候选，再进入人工生产线。",
    meta: "PROJECT CONFIG · MODEL VARIANTS · JOB HISTORY",
    href: withBase("/user-guide/workflows/ai-preannotate-pipeline"),
    kind: "image",
    src: prelabelUrl,
    alt: "项目级 AI 预标注配置面板",
  },
  {
    no: "04",
    kicker: "MODEL / OPERATIONS",
    title: "能力从后端可见、可管",
    desc: "模型市场集中呈现连接状态、任务能力和基础设施，让工作台只暴露真实可用的工具。",
    meta: "ML BACKEND · CAPABILITY ROUTING · HEALTH",
    href: withBase("/user-guide/superadmin/model-market"),
    kind: "image",
    src: modelMarketUrl,
    alt: "模型市场中的 ML Backend 列表与连接状态",
  },
];

const activeIndex = ref(0);
const activeScene = computed(() => scenes[activeIndex.value]);
const videoRef = ref<HTMLVideoElement | null>(null);
const autoplayVideo = ref(false);
const videoPlaying = ref(false);

async function playActiveVideo(): Promise<void> {
  await nextTick();
  if (activeScene.value.kind !== "video" || !autoplayVideo.value) return;
  await videoRef.value?.play()
    .then(() => { videoPlaying.value = true; })
    .catch(() => { videoPlaying.value = false; });
}

function selectScene(index: number): void {
  activeIndex.value = index;
}

async function toggleVideo(): Promise<void> {
  const video = videoRef.value;
  if (!video) return;
  if (video.paused) {
    await video.play()
      .then(() => { videoPlaying.value = true; })
      .catch(() => { videoPlaying.value = false; });
  } else {
    video.pause();
    videoPlaying.value = false;
  }
}

function onTabKeydown(event: KeyboardEvent, index: number): void {
  let next = index;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % scenes.length;
  else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + scenes.length) % scenes.length;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = scenes.length - 1;
  else return;

  event.preventDefault();
  activeIndex.value = next;
  const tabs = (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLButtonElement>(
    '[role="tab"]',
  );
  tabs?.[next]?.focus();
}

onMounted(() => {
  autoplayVideo.value =
    window.innerWidth > 600 &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  void playActiveVideo();
});

watch(activeIndex, () => {
  videoPlaying.value = false;
  void playActiveVideo();
});
</script>

<template>
  <section class="proof" id="proof">
    <span class="section-no">02 / PRODUCT PROOF</span>
    <div class="proof-head reveal">
      <h2>AI IN THE LOOP.<br />PROOF ON SCREEN.</h2>
      <p class="proof-intro">
        模型不是旁路演示，而是进入真实生产链路：给出候选，人完成类别与边界判断；预标注、OCR
        与模型状态都保留可追踪上下文。
      </p>
    </div>

    <div class="proof-experience reveal">
      <div class="proof-scenes" role="tablist" aria-label="真实产品场景">
        <button
          v-for="(scene, index) in scenes"
          :id="`proof-tab-${index}`"
          :key="scene.no"
          class="proof-scene"
          :class="{ active: activeIndex === index }"
          type="button"
          role="tab"
          :aria-selected="activeIndex === index"
          aria-controls="proof-panel"
          :tabindex="activeIndex === index ? 0 : -1"
          @click="selectScene(index)"
          @keydown="onTabKeydown($event, index)"
        >
          <span class="proof-scene-no">{{ scene.no }}</span>
          <span class="proof-scene-copy">
            <small>{{ scene.kicker }}</small>
            <strong>{{ scene.title }}</strong>
            <span>{{ scene.desc }}</span>
          </span>
        </button>
      </div>

      <div
        id="proof-panel"
        class="proof-media"
        role="tabpanel"
        :aria-labelledby="`proof-tab-${activeIndex}`"
      >
        <div class="proof-screen">
          <video
            v-if="activeScene.kind === 'video'"
            id="proof-video"
            ref="videoRef"
            :poster="activeScene.poster"
            muted
            loop
            playsinline
            :preload="autoplayVideo ? 'metadata' : 'none'"
            :aria-label="activeScene.alt"
          >
            <source :src="activeScene.src" type="video/webm" />
          </video>
          <img v-else :src="activeScene.src" :alt="activeScene.alt" />
          <button
            v-if="activeScene.kind === 'video'"
            class="proof-video-toggle"
            type="button"
            aria-controls="proof-video"
            :aria-label="videoPlaying ? '暂停 AI 标注演示' : '播放 AI 标注演示'"
            @click="toggleVideo"
          >
            {{ videoPlaying ? "PAUSE Ⅱ" : "PLAY ▶" }}
          </button>
          <span class="proof-media-tag" aria-hidden="true">REAL PRODUCT / {{ activeScene.no }}</span>
          <div class="screen-meta" aria-hidden="true">
            <span>{{ activeScene.meta }}</span>
            <span>SEED-BACKED SCENE</span>
          </div>
        </div>
        <a class="proof-deep-link" :href="activeScene.href">
          查看对应指南 <span aria-hidden="true">↗</span>
        </a>
        <div class="screen-stamp" aria-hidden="true">HUMAN<br />IN THE<br />LOOP</div>
      </div>
    </div>
  </section>
</template>
