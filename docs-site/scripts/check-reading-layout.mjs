#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const [mode, inputUrl, baselinePath] = process.argv.slice(2);
assert(
  ["capture", "verify"].includes(mode) && inputUrl && baselinePath,
  "Usage: node check-reading-layout.mjs capture|verify <preview-url> <baseline.json>",
);
const base = new URL(inputUrl.endsWith("/") ? inputUrl : `${inputUrl}/`);
assert(["http:", "https:"].includes(base.protocol), "Preview must use HTTP(S)");
const routes = [
  "user-guide/",
  "dev/",
  "api/",
  "ops/",
  "user-guide/getting-started",
  "user-guide/workbench/polygon",
  "user-guide/workbench/video-track",
  "dev/reference/ml-backend-protocol",
  "dev/concepts/overview",
  "ops/runbooks/celery-worker-stuck",
];
const session = `docs-reading-check-${process.pid}`;
const baseline = mode === "verify" ? JSON.parse(readFileSync(baselinePath, "utf8")) : {};
if (mode === "verify") {
  assert.deepEqual(Object.keys(baseline).sort(), [...routes].sort(), "Incomplete baseline");
  for (const route of routes) assert(baseline[route].length, `Empty baseline: ${route}`);
}

function browser(...args) {
  const response = JSON.parse(
    execFileSync("agent-browser", ["--session", session, "--json", ...args], {
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 8 * 1024 * 1024,
    }),
  );
  assert(response.success, JSON.stringify(response.error));
  return response.data;
}

function inspect() {
  return browser(
    "eval",
    `(() => {
      const article = document.querySelector('.vp-doc');
      const box = document.querySelector('.VPDoc .content-container');
      return {
        ids: [...article.querySelectorAll('[id]')].map(e => e.id),
        h1: article.querySelectorAll('h1').length,
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        width: box.getBoundingClientRect().width,
        sidebarWidth: document.querySelector('.VPSidebar').getBoundingClientRect().width,
        active: !!document.querySelector('.VPSidebarItem.is-active:not(.collapsed)'),
        context: document.querySelector('.doc-section')?.textContent.trim(),
        contextHref: document.querySelector('.doc-section a')?.getAttribute('href'),
        kind: document.querySelector('.doc-kind')?.textContent.trim(),
        aside: !!document.querySelector('.VPDoc .aside'),
        firstCard: article.querySelector('.doc-link-card')?.getBoundingClientRect().top,
        cards: [...article.querySelectorAll('.doc-link-card')].slice(0, 6).map(e => ({
          bottom: e.getBoundingClientRect().bottom,
          width: e.getBoundingClientRect().width,
          href: e.getAttribute('href')
        }))
      };
    })()`,
  ).result;
}

try {
  browser("set", "viewport", "1440", "960");
  for (const route of routes) {
    browser("open", new URL(route, base).href);
    browser(
      "wait",
      "--fn",
      "!!document.querySelector('.vp-doc h1') && !!document.querySelector('.VPSidebarItem.is-active')",
    );
    const initial = inspect();
    assert.equal(initial.h1, 1, `${route}: expected one H1`);
    assert.equal(new Set(initial.ids).size, initial.ids.length, `${route}: duplicate IDs`);
    if (mode === "capture") {
      baseline[route] = initial.ids;
      console.log(`Captured ${route}: ${initial.ids.length} anchors`);
      continue;
    }
    for (const id of baseline[route]) {
      assert(initial.ids.includes(id), `${route}: missing old anchor #${id}`);
    }
    const hub = routes.indexOf(route) < 4;
    for (const dark of [false, true]) {
      browser("eval", `document.documentElement.classList.toggle('dark', ${dark})`);
      for (const [width, height] of [
        [1440, 960],
        [390, 844],
      ]) {
        browser("set", "viewport", String(width), String(height));
        const state = inspect();
        const label = `${route} ${width}px ${dark ? "dark" : "light"}`;
        assert(!state.overflow, `${label}: page overflows`);
        assert(state.context, `${label}: missing domain context`);
        assert(state.contextHref?.startsWith(base.pathname), `${label}: wrong base prefix`);
        assert(state.active, `${label}: missing active sidebar branch`);
        if (hub) {
          assert(!state.aside, `${label}: hub should not reserve an outline column`);
          if (state.firstCard != null)
            assert(state.firstCard < height, `${label}: no task in first viewport`);
          for (const card of state.cards) {
            assert(card.href?.startsWith(base.pathname), `${label}: card lost base prefix`);
          }
        }
        if (width === 1440) {
          assert.equal(state.sidebarWidth, 256, `${label}: sidebar width`);
          assert(state.width >= (hub ? 900 : 730), `${label}: content too narrow (${state.width})`);
          assert(state.width <= (hub ? 1041 : 761), `${label}: content too wide`);
          if (route === "user-guide/") {
            assert(
              state.cards.length === 6 && state.cards.every((c) => c.bottom <= height),
              `${label}: primary tasks below fold`,
            );
            assert(
              state.cards.every((c) => c.width >= 260),
              `${label}: cramped cards`,
            );
          }
        }
      }
    }
    console.log(`Verified ${route}: anchors, navigation, light/dark, desktop/mobile`);
  }
  if (mode === "capture") {
    writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, { flag: "wx" });
  } else {
    browser("open", new URL("user-guide/workbench/polygon", base).href);
    browser("wait", "--fn", "!!document.querySelector('.vp-doc h1')");
    for (const width of [768, 1024, 1280]) {
      browser("set", "viewport", String(width), "960");
      assert(!inspect().overflow, `${width}px: intermediate breakpoint overflow`);
    }
    browser("open", new URL("changelog/", base).href);
    browser("wait", "--fn", "!!document.querySelector('.vp-doc h1')");
    assert(
      !browser("eval", "!!document.querySelector('.doc-kind')").result,
      "Missing type must not render an empty label",
    );
    console.log("Passed intermediate breakpoints and missing metadata.");
    for (const route of ["user-guide/getting-started", "user-guide/projects/"]) {
      browser("open", new URL(route, base).href);
      browser("wait", "--fn", "!!document.querySelector('.doc-theme-images')");
      for (const dark of [false, true]) {
        browser("eval", `document.documentElement.classList.toggle('dark', ${dark})`);
        const pair = browser(
          "eval",
          `(() => {
          const images = [...document.querySelectorAll('.doc-theme-images img')];
          return { count: images.length, visible: images.filter(img => img.getBoundingClientRect().width > 0).map(img => img.src) };
        })()`,
        ).result;
        assert.equal(pair.count, 2, `${route}: expected a light/dark image pair`);
        assert.equal(pair.visible.length, 1, `${route}: show exactly one theme image`);
        assert.equal(
          pair.visible[0].includes(".dark."),
          dark,
          `${route}: image must follow the document theme`,
        );
      }
    }
    console.log("Passed single-image light/dark screenshot pairs.");
    browser("open", base.href);
    browser(
      "wait",
      "--fn",
      "document.readyState === 'complete' && !!document.querySelector('.docs-home')",
    );
    browser("set", "viewport", "768", "960");
    assert(
      browser(
        "eval",
        "getComputedStyle(document.querySelector('.VPNavBarMenu')).display === 'none'",
      ).result,
      "Homepage tablet navigation must fit without clipping",
    );
    browser("click", ".VPNavBarHamburger");
    browser("wait", "--fn", "!!document.querySelector('.VPNavScreen')");
    for (const dark of [false, true]) {
      browser("eval", `document.documentElement.classList.toggle('dark', ${dark})`);
      browser(
        "wait",
        "--fn",
        "document.querySelector('.VPNavScreen').getAnimations().every(a => a.playState === 'finished')",
      );
      const contrast = browser(
        "eval",
        `(() => {
        const menu = document.querySelector('.VPNavScreen');
        const luminance = color => color.match(/[\\d.]+/g).slice(0, 3)
          .map(n => Number(n) / 255)
          .map(n => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4)
          .reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0);
        const fg = luminance(getComputedStyle(menu.querySelector('a')).color);
        const bg = luminance(getComputedStyle(menu).backgroundColor);
        return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
      })()`,
      ).result;
      assert(contrast >= 4.5, `Homepage menu contrast ${contrast} in ${dark ? "dark" : "light"}`);
    }
    browser("click", ".VPNavBarHamburger");
    console.log("Passed homepage tablet menu and light/dark contrast.");
  }
} finally {
  browser("close");
}
