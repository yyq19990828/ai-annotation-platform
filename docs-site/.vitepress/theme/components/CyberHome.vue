<script setup lang="ts">
/**
 * 赛博朋克风格文档站首页 Hero。
 * 鼠标动效(光晕跟随 / 卡片 3D 倾斜 / 磁吸按钮 / glitch / 拖尾)全部在
 * onMounted 中绑定、onUnmounted 中清理,SSR 期间不触碰 window/document。
 */
import { onMounted, onUnmounted, ref } from "vue";

const rootRef = ref<HTMLElement | null>(null);
let cleanup: Array<() => void> = [];

const roles = [
  { icon: "🖊️", title: "标注员", desc: "接受任务,完成 Bbox / Polygon / 关键点标注,用 SAM 智能工具提效。", more: "START ▸", link: "/user-guide/workbench/" },
  { icon: "📋", title: "项目管理员", desc: "创建项目、上传数据、配置规范、分配批次、开启 AI 预标注。", more: "MANAGE ▸", link: "/user-guide/projects/" },
  { icon: "✅", title: "审核员", desc: "检查已提交标注质量,一键通过或回退给标注员修正。", more: "REVIEW ▸", link: "/user-guide/review/" },
  { icon: "🔧", title: "部署运维", desc: "Docker Compose 一键启动,配置 ML Backend、监控与告警。", more: "DEPLOY ▸", link: "/ops/" },
  { icon: "💻", title: "贡献代码", desc: "5 分钟跑通本地环境,了解架构全景,完成第一个 PR。", more: "BUILD ▸", link: "/dev/tutorials/local-dev" },
  { icon: "🔌", title: "集成 API", desc: "JWT 认证,项目 / 任务 / 标注 / 导出完整 REST API。", more: "CONNECT ▸", link: "/api/" },
];

const caps = [
  { icon: "🎯", title: "多种标注类型", desc: "Bbox、Polygon、关键点、分类,支持图像与文本" },
  { icon: "🤖", title: "AI 预标注", desc: "集成 GroundingDINO / SAM,先生成候选再修正" },
  { icon: "👥", title: "协同与审核", desc: "任务分配、双盲审核、IoU 校验,确保数据质量" },
  { icon: "📦", title: "多格式导出", desc: "COCO、YOLO、Pascal VOC、Label Studio JSON" },
  { icon: "⚙️", title: "ML Backend", desc: "注册任意模型服务,实时预测与批量预标注" },
  { icon: "📊", title: "可观测性", desc: "性能 HUD、Celery 任务监控、审计日志" },
];

onMounted(() => {
  const root = rootRef.value;
  if (!root) return;

  // 动态注入赛博风字体,避免污染全站 <head>
  const fontLink = document.createElement("link");
  fontLink.rel = "stylesheet";
  fontLink.href = "https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=Rajdhani:wght@500;600;700&family=Share+Tech+Mono&display=swap";
  document.head.appendChild(fontLink);

  document.body.classList.add("cyber-active");

  const glow = root.querySelector<HTMLElement>(".cursor-glow");
  const ring = root.querySelector<HTMLElement>(".cursor-ring");
  const dot = root.querySelector<HTMLElement>(".cursor-dot");
  const gridFloor = root.querySelector<HTMLElement>(".grid-floor");
  let mx = window.innerWidth / 2, my = window.innerHeight / 2, rx = mx, ry = my;

  const onMove = (e: MouseEvent) => {
    mx = e.clientX; my = e.clientY;
    if (glow) { glow.style.setProperty("--mx", mx + "px"); glow.style.setProperty("--my", my + "px"); }
    if (dot) { dot.style.left = mx + "px"; dot.style.top = my + "px"; }
    if (gridFloor) gridFloor.style.setProperty("--gridShift", ((mx / window.innerWidth - 0.5) * 30) + "px");
  };
  window.addEventListener("mousemove", onMove);
  cleanup.push(() => window.removeEventListener("mousemove", onMove));

  // 光标环惯性跟随
  let raf = 0;
  const loop = () => {
    rx += (mx - rx) * 0.18; ry += (my - ry) * 0.18;
    if (ring) { ring.style.left = rx + "px"; ring.style.top = ry + "px"; }
    raf = requestAnimationFrame(loop);
  };
  loop();
  cleanup.push(() => cancelAnimationFrame(raf));

  // hover 放大光标环
  root.querySelectorAll<HTMLElement>("[data-hot],.cyber-card,.cyber-cap,.cyber-btn").forEach((el) => {
    const en = () => ring?.classList.add("hot");
    const lv = () => ring?.classList.remove("hot");
    el.addEventListener("mouseenter", en); el.addEventListener("mouseleave", lv);
    cleanup.push(() => { el.removeEventListener("mouseenter", en); el.removeEventListener("mouseleave", lv); });
  });

  // 卡片 3D 倾斜 + 光斑追踪
  root.querySelectorAll<HTMLElement>(".cyber-card").forEach((card) => {
    const mv = (e: MouseEvent) => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      card.style.transform = `perspective(800px) rotateX(${(0.5 - py) * 16}deg) rotateY(${(px - 0.5) * 16}deg) translateZ(6px)`;
      card.style.setProperty("--cx", px * 100 + "%");
      card.style.setProperty("--cy", py * 100 + "%");
    };
    const lv = () => { card.style.transform = "perspective(800px) rotateX(0) rotateY(0)"; };
    card.addEventListener("mousemove", mv); card.addEventListener("mouseleave", lv);
    cleanup.push(() => { card.removeEventListener("mousemove", mv); card.removeEventListener("mouseleave", lv); });
  });

  // 磁吸按钮
  root.querySelectorAll<HTMLElement>("[data-mag]").forEach((btn) => {
    const mv = (e: MouseEvent) => {
      const r = btn.getBoundingClientRect();
      btn.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * 0.25}px, ${(e.clientY - r.top - r.height / 2) * 0.35}px)`;
    };
    const lv = () => { btn.style.transform = "translate(0,0)"; };
    btn.addEventListener("mousemove", mv); btn.addEventListener("mouseleave", lv);
    cleanup.push(() => { btn.removeEventListener("mousemove", mv); btn.removeEventListener("mouseleave", lv); });
  });

  // 标题 glitch
  const g = root.querySelector<HTMLElement>(".glitch");
  const fire = () => { if (!g) return; g.classList.remove("go"); void g.offsetWidth; g.classList.add("go"); };
  g?.addEventListener("mouseenter", fire);
  const gi = window.setInterval(fire, 4200);
  cleanup.push(() => { g?.removeEventListener("mouseenter", fire); clearInterval(gi); });

  // 鼠标拖尾光点
  let last = 0;
  const trail = (e: MouseEvent) => {
    const now = performance.now(); if (now - last < 36) return; last = now;
    const p = document.createElement("div");
    p.className = "cyber-trail";
    p.style.cssText = `left:${e.clientX}px;top:${e.clientY}px`;
    root.appendChild(p);
    requestAnimationFrame(() => { p.style.opacity = "0"; p.style.transform = "translate(-50%,-50%) scale(.2)"; });
    window.setTimeout(() => p.remove(), 520);
  };
  window.addEventListener("mousemove", trail);
  cleanup.push(() => window.removeEventListener("mousemove", trail));

  cleanup.push(() => { document.body.classList.remove("cyber-active"); fontLink.remove(); });
});

onUnmounted(() => { cleanup.forEach((fn) => fn()); cleanup = []; });
</script>

<template>
  <div ref="rootRef" class="cyber-home">
    <div class="cursor-glow"></div>
    <div class="grid-floor"></div>
    <div class="scanlines"></div>
    <div class="vignette"></div>
    <div class="cursor-ring"></div>
    <div class="cursor-dot"></div>

    <section class="hero">
      <span class="eyebrow">SYSTEM ONLINE · AI-ASSISTED</span>
      <h1 class="glitch" data-text="一站式 AI 辅助标注">一站式 <span class="cy">AI</span> <span class="mg">辅助标注</span></h1>
      <p class="tag">为图像 / 文本 / 视频数据打标 — 集成 SAM 与 GroundingDINO,标注员只需修正候选。</p>
      <div class="btns">
        <a class="cyber-btn brand" data-mag data-hot href="/user-guide/getting-started">快速开始 ▸</a>
        <a class="cyber-btn ghost" data-mag data-hot href="/user-guide/">用户手册</a>
      </div>
      <div class="stats">
        <div class="stat"><div class="num">6</div><div class="lbl">标注类型</div></div>
        <div class="stat"><div class="num">4</div><div class="lbl">导出格式</div></div>
        <div class="stat"><div class="num">2</div><div class="lbl">AI 模型</div></div>
        <div class="stat"><div class="num">∞</div><div class="lbl">ML Backend</div></div>
      </div>
    </section>

    <section class="section">
      <div class="sec-head"><h2>选择你的<span class="br">入口</span></h2><div class="sub">// CHOOSE YOUR ROLE</div></div>
      <div class="grid">
        <a v-for="r in roles" :key="r.title" class="cyber-card" :href="r.link">
          <div class="ico">{{ r.icon }}</div>
          <h3>{{ r.title }}</h3>
          <p>{{ r.desc }}</p>
          <span class="more">{{ r.more }}</span>
        </a>
      </div>
    </section>

    <section class="section">
      <div class="sec-head"><h2>平台<span class="br">能力</span></h2><div class="sub">// CORE CAPABILITIES</div></div>
      <div class="caps">
        <div v-for="c in caps" :key="c.title" class="cyber-cap">
          <span class="ci">{{ c.icon }}</span>
          <div><h4>{{ c.title }}</h4><p>{{ c.desc }}</p></div>
        </div>
      </div>
    </section>

    <div class="foot">// AI ANNOTATION PLATFORM · 移动鼠标体验动效</div>
  </div>
</template>

<style scoped>
.cyber-home{
  --cyan:#00f0ff; --magenta:#ff00e5; --violet:#a855f7; --lime:#aaff00;
  --c-txt:#e8eaff; --c-dim:#8186b8; --c-border:rgba(0,240,255,.18);
  position:relative; background:#06060c; color:var(--c-txt);
  font-family:'Rajdhani','PingFang SC',sans-serif; min-height:100vh; overflow:hidden;
}

.cursor-glow{position:fixed; inset:0; pointer-events:none; z-index:1;
  background:radial-gradient(380px circle at var(--mx,50%) var(--my,30%), rgba(0,240,255,.10), transparent 60%),
             radial-gradient(520px circle at var(--mx,50%) var(--my,30%), rgba(255,0,229,.06), transparent 65%);}
.cursor-dot,.cursor-ring{position:fixed; top:0; left:0; pointer-events:none; z-index:9999; border-radius:50%; transform:translate(-50%,-50%);}
.cursor-dot{width:7px; height:7px; background:var(--cyan); box-shadow:0 0 12px var(--cyan),0 0 24px var(--cyan);}
.cursor-ring{width:34px; height:34px; border:1.5px solid rgba(0,240,255,.6); box-shadow:0 0 14px rgba(0,240,255,.4), inset 0 0 10px rgba(0,240,255,.2); transition:width .2s,height .2s,border-color .2s;}
.cursor-ring.hot{width:54px; height:54px; border-color:var(--magenta); box-shadow:0 0 20px rgba(255,0,229,.6), inset 0 0 14px rgba(255,0,229,.3);}

.scanlines{position:fixed; inset:0; pointer-events:none; z-index:50; opacity:.5; mix-blend-mode:multiply;
  background:repeating-linear-gradient(0deg, transparent 0, transparent 2px, rgba(0,0,0,.25) 3px, transparent 4px);}
.vignette{position:fixed; inset:0; pointer-events:none; z-index:49; box-shadow:inset 0 0 220px 40px rgba(0,0,0,.85);}

.grid-floor{position:fixed; left:0; right:0; bottom:0; height:55vh; z-index:0; pointer-events:none; perspective:340px; overflow:hidden;}
.grid-floor::before{content:''; position:absolute; left:-50%; right:-50%; bottom:-40%; height:160%;
  background-image:linear-gradient(rgba(0,240,255,.35) 1px, transparent 1px), linear-gradient(90deg, rgba(0,240,255,.35) 1px, transparent 1px);
  background-size:46px 46px; transform:rotateX(74deg) translateX(var(--gridShift,0)); transform-origin:bottom center;
  -webkit-mask-image:linear-gradient(to top, #000 0%, transparent 85%); mask-image:linear-gradient(to top, #000 0%, transparent 85%);
  animation:gridmove 3s linear infinite;}
@keyframes gridmove{from{background-position:0 0;}to{background-position:0 46px;}}

:deep(.cyber-trail){position:fixed; width:5px; height:5px; border-radius:50%; background:var(--cyan); box-shadow:0 0 8px var(--cyan); pointer-events:none; z-index:60; transform:translate(-50%,-50%); transition:opacity .5s, transform .5s;}

.hero{position:relative; z-index:10; padding:96px 42px 70px; text-align:center; min-height:82vh; display:flex; flex-direction:column; align-items:center; justify-content:center;}
.eyebrow{font-family:'Share Tech Mono',monospace; font-size:13px; letter-spacing:.3em; color:var(--cyan); border:1px solid var(--c-border); padding:7px 18px; margin-bottom:34px; text-transform:uppercase; background:rgba(0,240,255,.04); box-shadow:0 0 18px rgba(0,240,255,.15), inset 0 0 18px rgba(0,240,255,.06);}
.eyebrow::before{content:'▮ '; color:var(--magenta); animation:blink 1.1s steps(1) infinite;}
@keyframes blink{50%{opacity:0;}}

.glitch{font-family:'Orbitron',sans-serif; font-weight:900; font-size:72px; line-height:1.04; color:#fff; position:relative; text-shadow:0 0 24px rgba(0,240,255,.5); margin:0;}
.glitch .cy{color:var(--cyan); text-shadow:0 0 28px var(--cyan);}
.glitch .mg{color:var(--magenta); text-shadow:0 0 28px var(--magenta);}
.glitch::before,.glitch::after{content:attr(data-text); position:absolute; left:0; top:0; width:100%; opacity:0; pointer-events:none;}
.glitch.go::before{opacity:.85; color:var(--magenta); animation:gA .4s steps(2) 1; clip-path:inset(0 0 55% 0);}
.glitch.go::after{opacity:.85; color:var(--cyan); animation:gB .4s steps(2) 1; clip-path:inset(55% 0 0 0);}
@keyframes gA{0%,100%{transform:translate(0)}25%{transform:translate(-4px,-2px)}50%{transform:translate(3px,1px)}75%{transform:translate(-2px,2px)}}
@keyframes gB{0%,100%{transform:translate(0)}25%{transform:translate(4px,2px)}50%{transform:translate(-3px,-1px)}75%{transform:translate(2px,-2px)}}

.hero .tag{margin:30px 0 0; font-size:20px; font-weight:500; color:var(--c-dim); max-width:600px; line-height:1.5;}
.btns{display:flex; gap:20px; margin-top:44px; flex-wrap:wrap; justify-content:center;}
.cyber-btn{font-family:'Rajdhani',sans-serif; font-weight:700; font-size:16px; letter-spacing:.08em; padding:15px 34px; text-transform:uppercase; position:relative; text-decoration:none; transition:box-shadow .2s; will-change:transform;}
.cyber-btn.brand{color:#04141a; background:linear-gradient(100deg,var(--cyan),#5ffbff); box-shadow:0 0 24px rgba(0,240,255,.5), 0 0 60px rgba(0,240,255,.25);}
.cyber-btn.brand:hover{box-shadow:0 0 36px rgba(0,240,255,.8), 0 0 90px rgba(0,240,255,.4);}
.cyber-btn.ghost{color:var(--cyan); background:rgba(0,240,255,.04); border:1px solid var(--cyan); box-shadow:inset 0 0 16px rgba(0,240,255,.12);}
.cyber-btn.ghost:hover{background:rgba(0,240,255,.1);}

.stats{display:flex; gap:54px; margin-top:64px; flex-wrap:wrap; justify-content:center;}
.stat{text-align:center;}
.stat .num{font-family:'Orbitron',sans-serif; font-weight:900; font-size:40px; color:#fff; text-shadow:0 0 22px rgba(0,240,255,.6);}
.stat:nth-child(2) .num{color:var(--magenta); text-shadow:0 0 22px var(--magenta);}
.stat:nth-child(3) .num{color:var(--violet); text-shadow:0 0 22px var(--violet);}
.stat:nth-child(4) .num{color:var(--lime); text-shadow:0 0 22px var(--lime);}
.stat .lbl{font-family:'Share Tech Mono',monospace; font-size:12px; letter-spacing:.18em; color:var(--c-dim); margin-top:8px; text-transform:uppercase;}

.section{position:relative; z-index:10; padding:64px 42px; max-width:1180px; margin:0 auto;}
.sec-head{text-align:center; margin-bottom:48px;}
.sec-head h2{font-family:'Orbitron',sans-serif; font-weight:700; font-size:32px; color:#fff; letter-spacing:.04em; text-shadow:0 0 20px rgba(168,85,247,.5); margin:0;}
.sec-head h2 .br{color:var(--violet);}
.sec-head .sub{font-family:'Share Tech Mono',monospace; font-size:13px; color:var(--c-dim); letter-spacing:.2em; margin-top:12px; text-transform:uppercase;}

.grid{display:grid; grid-template-columns:repeat(3,1fr); gap:24px;}
.cyber-card{position:relative; display:block; text-decoration:none; background:linear-gradient(160deg,rgba(13,13,26,.9),rgba(10,10,20,.7)); border:1px solid var(--c-border); padding:30px 26px; transform-style:preserve-3d; transition:border-color .25s, box-shadow .25s; will-change:transform; overflow:hidden;}
.cyber-card .spot,.cyber-card::after,.cyber-card::before{}
.cyber-card .ico,.cyber-card h3,.cyber-card p,.cyber-card .more{position:relative; z-index:2;}
.cyber-card::after{content:''; position:absolute; inset:0; z-index:1; opacity:0; transition:opacity .25s; background:radial-gradient(220px circle at var(--cx,50%) var(--cy,50%), rgba(0,240,255,.16), transparent 60%);}
.cyber-card:hover{border-color:rgba(0,240,255,.6); box-shadow:0 0 0 1px rgba(0,240,255,.3), 0 18px 50px -16px rgba(0,240,255,.5);}
.cyber-card:hover::after{opacity:1;}
.cyber-card .ico{font-size:30px; margin-bottom:18px; filter:drop-shadow(0 0 10px rgba(0,240,255,.6)); transform:translateZ(40px); display:inline-block;}
.cyber-card h3{font-family:'Orbitron',sans-serif; font-weight:700; font-size:18px; color:#fff; margin:0 0 10px; transform:translateZ(28px);}
.cyber-card p{font-size:15px; font-weight:500; color:var(--c-dim); line-height:1.6; margin:0; transform:translateZ(16px);}
.cyber-card .more{display:inline-block; margin-top:16px; font-family:'Share Tech Mono',monospace; font-size:13px; color:var(--cyan); letter-spacing:.1em; transform:translateZ(20px);}

.caps{display:grid; grid-template-columns:repeat(2,1fr); gap:18px;}
.cyber-cap{display:flex; gap:16px; padding:20px 22px; background:rgba(13,13,26,.6); border:1px solid var(--c-border); border-left:2px solid var(--violet); transition:.2s;}
.cyber-cap:hover{background:rgba(168,85,247,.06); border-left-color:var(--magenta);}
.cyber-cap .ci{font-size:22px; filter:drop-shadow(0 0 8px rgba(168,85,247,.6));}
.cyber-cap h4{font-family:'Orbitron',sans-serif; font-size:15px; color:#fff; margin:0 0 5px;}
.cyber-cap p{font-size:14px; color:var(--c-dim); line-height:1.5; margin:0;}

.foot{position:relative; z-index:10; text-align:center; padding:40px; font-family:'Share Tech Mono',monospace; font-size:12px; color:var(--c-dim); letter-spacing:.15em;}

@media (max-width:860px){
  .grid,.caps{grid-template-columns:1fr;}
  .glitch{font-size:46px;}
  .stats{gap:30px;}
}
</style>
