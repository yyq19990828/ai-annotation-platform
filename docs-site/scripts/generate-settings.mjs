#!/usr/bin/env node
// 从 apps/web/src/pages/Workbench/state/workbenchSettingsFields.ts 的
// WORKBENCH_SETTING_FIELDS(字段) + WORKBENCH_SETTING_CATEGORY_LABELS(分类标签),
// 以及 apps/web/src/api/auth.ts 的 DEFAULT_WORKBENCH_PREFERENCES(默认值),
// 生成 docs-site/user-guide/workbench/settings.generated.md。
//
// 在 docs:dev / docs:build 之前自动执行,与 generate-hotkeys.mjs 同款。
// 用 brace 扫描 + regex 解析纯字面量,无需 ts-node / tsc;解析失败报错退出,
// 让漂移暴露在 CI 而不是文档站静默错乱。
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { emitGenerated } from "./_emit.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fieldsSrc = resolve(here, "../../apps/web/src/pages/Workbench/state/workbenchSettingsFields.ts");
const authSrc = resolve(here, "../../apps/web/src/api/auth.ts");
const dst = resolve(here, "../user-guide/workbench/settings.generated.md");

const STR = `"(?:[^"\\\\]|\\\\.)*"`;
const unquote = (s) => s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");

// ── 取某个 `name = {...}` / `name: Type = {...}` 后第一个平衡花括号块的内部文本。
// 跳过字符串(单/双/反引号)与 // 行注释,避免注释里的花括号 / 引号干扰括号配平。
function extractBraceBlock(text, anchorRe) {
  const m = text.match(anchorRe);
  if (!m) return null;
  let i = text.indexOf("{", m.index);
  if (i < 0) return null;
  const start = i;
  let depth = 0;
  for (; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      i++;
      while (i < text.length && text[i] !== q) {
        if (text[i] === "\\") i++;
        i++;
      }
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return text.slice(start + 1, i);
    }
  }
  return null;
}

// ── 把数组字面量内部文本切成 depth-1 的对象块(尊重字符串 / 行注释)。
function splitObjects(arrInner) {
  const objs = [];
  let depth = 0;
  let objStart = -1;
  for (let i = 0; i < arrInner.length; i++) {
    const c = arrInner[i];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      i++;
      while (i < arrInner.length && arrInner[i] !== q) {
        if (arrInner[i] === "\\") i++;
        i++;
      }
      continue;
    }
    if (c === "/" && arrInner[i + 1] === "/") {
      while (i < arrInner.length && arrInner[i] !== "\n") i++;
      continue;
    }
    if (c === "{") {
      if (depth === 0) objStart = i;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0 && objStart >= 0) {
        objs.push(arrInner.slice(objStart, i + 1));
        objStart = -1;
      }
    }
  }
  return objs;
}

const fieldsText = readFileSync(fieldsSrc, "utf8");
const authText = readFileSync(authSrc, "utf8");

// 1. 分类标签
const catInner = extractBraceBlock(
  fieldsText,
  /export const WORKBENCH_SETTING_CATEGORY_LABELS\b/,
);
if (!catInner) {
  console.error("[generate-settings] 未找到 WORKBENCH_SETTING_CATEGORY_LABELS,源结构是否变了？");
  process.exit(1);
}
const categoryLabels = {};
const categoryOrder = [];
for (const m of catInner.matchAll(new RegExp(`(\\w+):\\s*(${STR})`, "g"))) {
  categoryLabels[m[1]] = unquote(m[2]);
  categoryOrder.push(m[1]);
}

// 2. 字段数组
const arrAnchor = fieldsText.match(/export const WORKBENCH_SETTING_FIELDS\b/);
if (!arrAnchor) {
  console.error("[generate-settings] 未找到 WORKBENCH_SETTING_FIELDS。");
  process.exit(1);
}
// 跳过类型标注里的 `[]`(WorkbenchSettingField[]):先定位 `=`,再找数组起始 `[`。
const eqIdx = fieldsText.indexOf("=", arrAnchor.index);
const bracketStart = fieldsText.indexOf("[", eqIdx);
// 取数组字面量(到匹配的 `]`):用 brace 扫描里的同类逻辑,但配平方括号。
let depth = 0;
let arrEnd = -1;
for (let i = bracketStart; i < fieldsText.length; i++) {
  const c = fieldsText[i];
  if (c === '"' || c === "'" || c === "`") {
    const q = c;
    i++;
    while (i < fieldsText.length && fieldsText[i] !== q) {
      if (fieldsText[i] === "\\") i++;
      i++;
    }
    continue;
  }
  if (c === "/" && fieldsText[i + 1] === "/") {
    while (i < fieldsText.length && fieldsText[i] !== "\n") i++;
    continue;
  }
  if (c === "[") depth++;
  else if (c === "]") {
    depth--;
    if (depth === 0) {
      arrEnd = i;
      break;
    }
  }
}
const arrInner = fieldsText.slice(bracketStart + 1, arrEnd);
const objs = splitObjects(arrInner);

const fields = [];
for (const o of objs) {
  const key = o.match(/\bkey:\s*"([^"]+)"/)?.[1];
  const category = o.match(/\bcategory:\s*"(\w+)"/)?.[1];
  const label = o.match(new RegExp(`\\blabel:\\s*(${STR})`))?.[1];
  if (!key || !category || !label) continue;
  const hidden = /\bhidden:\s*true/.test(o);
  if (hidden) continue; // 注册但不渲染,不进文档
  const descM = o.match(new RegExp(`\\bdescription:\\s*(${STR})`));
  const parentKey = o.match(/\bparentKey:\s*"([^"]+)"/)?.[1];
  const ctrlType = o.match(/\bcontrol:\s*\{\s*type:\s*"(\w+)"/)?.[1];
  // select 选项: value + label
  const options = [];
  const optBlock = o.match(/options:\s*\[([\s\S]*?)\]/);
  if (optBlock) {
    const optRe = new RegExp(`value:\\s*(${STR}|true|false|-?[\\d.]+)\\s*,\\s*label:\\s*(${STR})`, "g");
    for (const om of optBlock[1].matchAll(optRe)) {
      options.push({ value: om[1], label: unquote(om[2]) });
    }
  }
  fields.push({
    key,
    category,
    name: key.slice(category.length + 1),
    label: unquote(label),
    description: descM ? unquote(descM[1]) : "",
    parentKey,
    ctrlType,
    options,
  });
}
if (fields.length === 0) {
  console.error("[generate-settings] 解析到 0 个字段;regex 与源不匹配。");
  process.exit(1);
}

// 3. 默认值: 从 DEFAULT_WORKBENCH_PREFERENCES 的各分类子树解析扁平 name: value
const prefInner = extractBraceBlock(authText, /export const DEFAULT_WORKBENCH_PREFERENCES\b/);
const defaults = {}; // category -> { name: rawValueString }
if (prefInner) {
  for (const cat of ["common", "image", "video", "pointcloud"]) {
    const sub = extractBraceBlock(prefInner, new RegExp(`(?:^|\\n)\\s*${cat}:`));
    if (!sub) continue;
    defaults[cat] = {};
    const valRe = new RegExp(`(\\w+):\\s*(${STR}|true|false|-?[\\d.]+)`, "g");
    for (const vm of sub.matchAll(valRe)) {
      defaults[cat][vm[1]] = vm[2];
    }
  }
}

// 把原始字面量值规整成可比较的 JS 值。
const norm = (raw) => {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?[\d.]+$/.test(raw)) return Number(raw);
  return unquote(raw);
};

// 本机 local 字段(不在 preferences 默认树)中默认「开启」的覆盖。
// experiment.videoKonva 自 v0.16.4 切默认为开(逃生舱仍可关),见 videoKonvaFlag.ts。
const LOCAL_TOGGLE_DEFAULT_ON = new Set(["experiment.videoKonva"]);

// 默认值的人类可读呈现。
function renderDefault(field) {
  const raw = defaults[field.category]?.[field.name];
  // 实验特性等不在 preferences 默认树里:toggle 默认「关闭」,除非在 default-on 覆盖集。
  if (raw === undefined) {
    if (field.ctrlType !== "toggle") return "—";
    return LOCAL_TOGGLE_DEFAULT_ON.has(`${field.category}.${field.name}`) ? "开启" : "关闭";
  }
  const val = norm(raw);
  if (field.ctrlType === "toggle") return val ? "开启" : "关闭";
  if (field.ctrlType === "select") {
    const hit = field.options.find((o) => norm(o.value) === val);
    return hit ? hit.label : String(val);
  }
  if (field.ctrlType === "text") return val === "" ? "空" : `\`${val}\``;
  return String(val); // slider:原始数值
}

// 4. 生成 Markdown
const lines = [];
lines.push("<!-- AUTO-GENERATED — 由 docs-site/scripts/generate-settings.mjs 从 -->");
lines.push("<!-- apps/web/src/pages/Workbench/state/workbenchSettingsFields.ts + -->");
lines.push("<!-- apps/web/src/api/auth.ts 生成。请勿手改。 -->");
lines.push("");

const esc = (s) => s.replace(/\|/g, "\\|");

for (const cat of categoryOrder) {
  const list = fields.filter((f) => f.category === cat);
  if (list.length === 0) continue;
  lines.push(`### ${categoryLabels[cat]}`);
  lines.push("");
  lines.push("| 设置项 | 说明 | 默认 |");
  lines.push("|---|---|---|");
  for (const f of list) {
    const label = f.parentKey ? `└ ${f.label}` : f.label;
    lines.push(`| ${esc(label)} | ${esc(f.description)} | ${esc(renderDefault(f))} |`);
  }
  lines.push("");
}

emitGenerated({
  dst,
  content: lines.join("\n"),
  label: "generate-settings",
  detail: `${fields.length} fields`,
});
