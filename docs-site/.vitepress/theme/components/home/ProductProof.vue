<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { withBase } from "vitepress";
import prelabelUrl from "../../../../user-guide/images/projects/ai-pre-config-panel.png";
import modelMarketUrl from "../../../../user-guide/images/superadmin/model-market/list.png";

type ProofSceneBase = {
  no: string;
  kicker: string;
  title: string;
  desc: string;
  href: string;
};

type ProofScene = ProofSceneBase & (
  | { kind: "tools" }
  | {
      kind: "image";
      src: string;
      meta: string;
      alt: string;
    }
  | {
      kind: "video";
      src: string;
      poster: string;
      meta: string;
      alt: string;
    }
);

type ToolPreview = {
  no: string;
  name: string;
  kicker: string;
  desc: string;
  meta: string;
  src: string;
  poster: string;
  alt: string;
};

const toolPreviews: ToolPreview[] = [
  {
    no: "01",
    name: "智能点",
    kicker: "POINT PROMPT",
    desc: "在目标上点一下，SAM3 返回贴合车辆轮廓的多个候选。",
    meta: "SMART POINT · ONE CLICK · CANDIDATE MASKS",
    src: withBase("/home/sam-tools/smart-point.webm"),
    poster: withBase("/home/sam-tools/smart-point-poster.webp"),
    alt: "在真实道路图中点击白色车辆，使用 SAM3 生成轮廓候选",
  },
  {
    no: "02",
    name: "智能框",
    kicker: "BOX PROMPT",
    desc: "拖框限定目标范围，让 SAM3 在框内提取完整车辆边界。",
    meta: "SMART BOX · BOX PROMPT · POLYGON RESULT",
    src: withBase("/home/sam-tools/smart-box.webm"),
    poster: withBase("/home/sam-tools/smart-box-poster.webp"),
    alt: "在真实道路图中框选白色车辆，使用 SAM3 提取车辆边界",
  },
  {
    no: "03",
    name: "Magic Box",
    kicker: "TIGHT BBOX",
    desc: "只需粗框目标，SAM3 自动收紧为贴合车辆的矩形框，再确认类别。",
    meta: "MAGIC BOX · AUTO TIGHTEN · HUMAN ACCEPT",
    src: withBase("/home/ai-assisted-annotation.webm"),
    poster: withBase("/home/ai-assisted-annotation-poster.webp"),
    alt: "在真实道路图中粗框白色车辆，使用 SAM3 收紧框并确认类别",
  },
  {
    no: "04",
    name: "Exemplar",
    kicker: "VISUAL EXAMPLE",
    desc: "框一辆车作为视觉示例，一次找出全图中外观相似的目标。",
    meta: "EXEMPLAR · VISUAL QUERY · FIND SIMILAR",
    src: withBase("/home/sam-tools/exemplar.webm"),
    poster: withBase("/home/sam-tools/exemplar-poster.webp"),
    alt: "在真实道路图中框选白色车辆作为视觉示例，找出全图相似车辆",
  },
];

const scenes: ProofScene[] = [
  {
    no: "01",
    kicker: "4 TOOLS / SAM3",
    title: "点、框、收紧、找同类",
    desc: "智能点、智能框、Magic Box 与 Exemplar 四种真实推理，可左右切换查看。",
    href: withBase("/user-guide/workbench/sam-tool"),
    kind: "tools",
  },
  {
    no: "02",
    kicker: "DOCUMENT / OCR",
    title: "识别之后，继续修正",
    desc: "真实文档图进入当前题推理，模型版本、参数与结果和任务上下文一起保留。",
    meta: "RAPIDOCR · CURRENT TASK · TRACEABLE PARAMS",
    href: withBase("/user-guide/projects/ai-preannotate"),
    kind: "video",
    src: withBase("/home/ocr-real-scene.webm"),
    poster: withBase("/home/ocr-real-scene-poster.webp"),
    alt: "真实 OCR 当前题从启动推理到生成文本多边形候选",
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
const activeToolIndex = ref(0);
const activeScene = computed(() => scenes[activeIndex.value]);
const activeTool = computed(() => toolPreviews[activeToolIndex.value]);
const toolDirection = ref<1 | -1>(1);
const toolTransitionName = computed(() =>
  toolDirection.value === 1 ? "proof-tool-next" : "proof-tool-prev",
);
const videoRef = ref<HTMLVideoElement | null>(null);
const sectionRef = ref<HTMLElement | null>(null);
const autoplayVideo = ref(false);
const mediaInView = ref(false);
const videoPlaying = ref(false);
const touchStartX = ref<number | null>(null);
let mediaObserver: IntersectionObserver | undefined;

async function playActiveVideo(): Promise<void> {
  await nextTick();
  if (
    activeScene.value.kind === "image" ||
    !autoplayVideo.value ||
    !mediaInView.value
  ) return;
  await videoRef.value?.play()
    .then(() => { videoPlaying.value = true; })
    .catch(() => { videoPlaying.value = false; });
}

function selectScene(index: number): void {
  activeIndex.value = index;
}

function selectTool(index: number): void {
  if (index === activeToolIndex.value) return;
  toolDirection.value = index > activeToolIndex.value ? 1 : -1;
  activeToolIndex.value = index;
}

function stepTool(delta: 1 | -1): void {
  toolDirection.value = delta;
  activeToolIndex.value =
    (activeToolIndex.value + delta + toolPreviews.length) % toolPreviews.length;
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

function onToolCarouselKeydown(event: KeyboardEvent): void {
  if (event.currentTarget !== event.target) return;
  if (event.key === "ArrowRight") stepTool(1);
  else if (event.key === "ArrowLeft") stepTool(-1);
  else return;
  event.preventDefault();
}

function onTouchStart(event: TouchEvent): void {
  touchStartX.value = event.touches[0]?.clientX ?? null;
}

function onTouchEnd(event: TouchEvent): void {
  if (touchStartX.value === null) return;
  const endX = event.changedTouches[0]?.clientX;
  const delta = endX === undefined ? 0 : endX - touchStartX.value;
  touchStartX.value = null;
  if (Math.abs(delta) < 44) return;
  stepTool(delta < 0 ? 1 : -1);
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
  mediaObserver = new IntersectionObserver(([entry]) => {
    mediaInView.value = entry?.isIntersecting ?? false;
    if (mediaInView.value) void playActiveVideo();
    else {
      videoRef.value?.pause();
      videoPlaying.value = false;
    }
  }, { threshold: 0.15 });
  if (sectionRef.value) mediaObserver.observe(sectionRef.value);
});

onBeforeUnmount(() => mediaObserver?.disconnect());

watch([activeIndex, activeToolIndex], () => {
  videoPlaying.value = false;
  void playActiveVideo();
});
</script>

<template>
  <section ref="sectionRef" class="proof" id="proof">
    <span class="section-no">02 / PRODUCT PROOF</span>
    <div class="proof-head reveal">
      <h2>AI IN THE LOOP.<br />PROOF ON SCREEN.</h2>
      <p class="proof-intro">
        从单目标交互到全图召回，四种 SAM3 工具都以真实推理结果为起点；OCR、批量预标注
        与模型状态则保留可追踪的生产上下文。
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
          <div
            v-if="activeScene.kind === 'tools'"
            class="proof-tool-carousel"
            role="region"
            aria-roledescription="carousel"
            aria-label="SAM3 四种交互工具预览"
            tabindex="0"
            @keydown="onToolCarouselKeydown"
            @touchstart.passive="onTouchStart"
            @touchend.passive="onTouchEnd"
          >
            <div class="proof-tool-viewport">
              <Transition
                :name="toolTransitionName"
                @after-enter="playActiveVideo"
              >
                <video
                  :id="`proof-tool-video-${activeTool.no}`"
                  :key="activeTool.no"
                  ref="videoRef"
                  :poster="activeTool.poster"
                  muted
                  loop
                  playsinline
                  :preload="autoplayVideo && mediaInView ? 'metadata' : 'none'"
                  :aria-label="activeTool.alt"
                  @play="videoPlaying = true"
                  @pause="videoPlaying = false"
                >
                  <source :src="activeTool.src" type="video/webm" />
                </video>
              </Transition>
              <button
                class="proof-video-toggle"
                type="button"
                :aria-controls="`proof-tool-video-${activeTool.no}`"
                :aria-label="
                  videoPlaying ? `暂停${activeTool.name}演示` : `播放${activeTool.name}演示`
                "
                @click="toggleVideo"
              >
                {{ videoPlaying ? "PAUSE Ⅱ" : "PLAY ▶" }}
              </button>
            </div>

            <div class="proof-tool-copy" aria-live="polite">
              <span>{{ activeTool.no }} / 04 · {{ activeTool.kicker }}</span>
              <strong>{{ activeTool.name }}</strong>
              <p>{{ activeTool.desc }}</p>
            </div>

            <div class="proof-tool-controls">
              <button type="button" aria-label="上一个 SAM3 工具" @click="stepTool(-1)">
                ←
              </button>
              <div class="proof-tool-list" aria-label="选择 SAM3 工具">
                <button
                  v-for="(tool, index) in toolPreviews"
                  :key="tool.no"
                  type="button"
                  :class="{ active: activeToolIndex === index }"
                  :aria-pressed="activeToolIndex === index"
                  @click="selectTool(index)"
                >
                  <span>{{ tool.no }}</span>{{ tool.name }}
                </button>
              </div>
              <button type="button" aria-label="下一个 SAM3 工具" @click="stepTool(1)">
                →
              </button>
            </div>
          </div>

          <video
            v-else-if="activeScene.kind === 'video'"
            id="proof-scene-video"
            ref="videoRef"
            :poster="activeScene.poster"
            muted
            loop
            playsinline
            :preload="autoplayVideo && mediaInView ? 'metadata' : 'none'"
            :aria-label="activeScene.alt"
            @play="videoPlaying = true"
            @pause="videoPlaying = false"
          >
            <source :src="activeScene.src" type="video/webm" />
          </video>
          <img v-else :src="activeScene.src" :alt="activeScene.alt" loading="lazy" decoding="async" />
          <button
            v-if="activeScene.kind === 'video'"
            class="proof-video-toggle"
            type="button"
            aria-controls="proof-scene-video"
            :aria-label="videoPlaying ? '暂停 OCR 演示' : '播放 OCR 演示'"
            @click="toggleVideo"
          >
            {{ videoPlaying ? "PAUSE Ⅱ" : "PLAY ▶" }}
          </button>
          <span class="proof-media-tag" aria-hidden="true">
            {{
              activeScene.kind === "tools"
                ? `LIVE SAM3 / ${activeTool.no}`
                : `REAL PRODUCT / ${activeScene.no}`
            }}
          </span>
          <div class="screen-meta" aria-hidden="true">
            <span>{{ activeScene.kind === "tools" ? activeTool.meta : activeScene.meta }}</span>
            <span>
              {{
                activeScene.kind === "tools"
                  ? "4 TOOLS · REAL INFERENCE"
                  : "SEED-BACKED SCENE"
              }}
            </span>
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
