#!/usr/bin/env node
/**
 * Reports rendered Markdown pages that cannot be reached from a sidebar or
 * another rendered Markdown page. It is warning-only by default; use
 * --strict once an intentional-exemption list has been reviewed.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const docsRoot = path.resolve(here, "..");
const strict = process.argv.includes("--strict");

const SKIP_DIRS = new Set([".vitepress", "adr", "changelog", "examples", "node_modules", "public", "roadmap", "scripts"]);
const SKIP_FILES = new Set(["IMAGE_CHECKLIST.md"]);

// Pages that deliberately remain directly addressable but are not discoverable
// in navigation. Add a reason here instead of silently accepting an orphan.
const EXEMPT_ROUTES = new Map([
  ["/user-guide/projects/annotation-guide", "the feature is disabled; retained as a direct historical reference"],
]);

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), files);
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".md") &&
      !entry.name.endsWith(".generated.md") &&
      !SKIP_FILES.has(entry.name)
    ) {
      files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

function routeForFile(file) {
  const rel = path.relative(docsRoot, file).replace(/\\/g, "/");
  if (rel === "index.md") return "/";
  if (rel.endsWith("/index.md")) return `/${rel.slice(0, -"index.md".length)}`;
  return `/${rel.slice(0, -".md".length)}`;
}

function normalizeRoute(route) {
  const normalized = path.posix.normalize(route).replace(/^\.(?=\/)/, "");
  return normalized === "/." ? "/" : normalized.replace(/\/$/, "") || "/";
}

function routeForTarget(target, sourceFile) {
  const clean = target.split(/[?#]/, 1)[0];
  if (!clean || clean.startsWith("#") || /^(?:[a-z]+:|\/\/)/i.test(clean)) return null;

  if (clean.startsWith("/")) return normalizeRoute(clean);

  const resolved = path.resolve(path.dirname(sourceFile), clean);
  const rel = path.relative(docsRoot, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  if (path.extname(rel) && path.extname(rel) !== ".md") return null;
  return normalizeRoute(routeForFile(resolved.endsWith(".md") ? resolved : `${resolved}.md`));
}

function recordLinks(content, sourceFile, discovered) {
  const inline = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let match;
  while ((match = inline.exec(content)) !== null) {
    const route = routeForTarget(match[1], sourceFile);
    if (route) discovered.add(route);
  }
}

const pages = walk(docsRoot);
const pageRoutes = new Map(pages.map((file) => [normalizeRoute(routeForFile(file)), file]));
const discovered = new Set(["/"]);

for (const page of pages) recordLinks(fs.readFileSync(page, "utf8"), page, discovered);

const config = fs.readFileSync(path.join(docsRoot, ".vitepress", "config.ts"), "utf8");
const configLink = /\blink:\s*["']([^"']+)["']/g;
let match;
while ((match = configLink.exec(config)) !== null) {
  const route = routeForTarget(match[1], path.join(docsRoot, "index.md"));
  if (route) discovered.add(route);
}

const missing = [...pageRoutes.keys()]
  .filter((route) => !discovered.has(route) && !EXEMPT_ROUTES.has(route))
  .sort();

console.log(`Navigation coverage — ${pageRoutes.size} rendered pages`);
if (missing.length === 0) {
  console.log("✓ All pages are reachable from navigation or another rendered page.");
} else {
  for (const route of missing) console.log(`✗ ${route}`);
  console.log(`\n${missing.length} page(s) are not reachable. Add a navigation or page link, or record an intentional exemption.`);
}

if (EXEMPT_ROUTES.size > 0) {
  console.log("\nIntentional exemptions:");
  for (const [route, reason] of EXEMPT_ROUTES) console.log(`○ ${route} — ${reason}`);
}

if (strict && missing.length > 0) process.exit(1);
