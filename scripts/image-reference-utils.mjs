import fs from "node:fs";
import path from "node:path";

export const IMAGE_EXTENSION_RE = /\.(?:png|gif|jpe?g|webp|svg)$/i;

export function* walkFiles(dir, predicate = () => true) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkFiles(full, predicate);
    else if (predicate(entry.name)) yield full;
  }
}

export function extractImageReferences(markdown) {
  const references = [];
  const imageRe =
    /!\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\)|<(img|AutoImage)\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/g;
  let match;
  while ((match = imageRe.exec(markdown)) !== null) {
    const src = (match[1] || match[2] || match[4] || "").trim();
    if (!src) continue;
    references.push({
      src,
      kind: match[3]?.toLowerCase() === "autoimage" ? "auto-image" : "markdown",
    });
  }
  return references;
}

function cleanSource(src) {
  return src.split(/[?#]/, 1)[0];
}

export function resolveImageReference({ src, kind, mdPath, repoRoot, docsRoot }) {
  const cleaned = cleanSource(src);
  if (!cleaned || /^(?:https?:|data:|mailto:)/i.test(cleaned)) return null;

  let absolute;
  if (kind === "auto-image") {
    const repoPrefix = "docs-site/user-guide/images/";
    const publicPrefix = "/user-guide/images/";
    if (cleaned.startsWith(repoPrefix)) {
      absolute = path.join(repoRoot, cleaned);
    } else if (cleaned.startsWith(publicPrefix)) {
      absolute = path.join(docsRoot, cleaned.slice(1));
    } else if (cleaned.startsWith("/")) {
      absolute = path.join(docsRoot, cleaned.slice(1));
    } else {
      absolute = path.join(
        docsRoot,
        "user-guide/images",
        cleaned.replace(/^images\//, ""),
      );
    }
  } else {
    absolute = cleaned.startsWith("/")
      ? path.join(docsRoot, cleaned.slice(1))
      : path.resolve(path.dirname(mdPath), cleaned);
  }

  return {
    absolute: path.normalize(absolute),
    key: path.relative(repoRoot, absolute).replace(/\\/g, "/"),
  };
}

export function collectMarkdownImageReferences({ scanRoot, repoRoot, docsRoot }) {
  const references = new Map();
  for (const mdPath of walkFiles(scanRoot, (name) => name.endsWith(".md"))) {
    const content = fs.readFileSync(mdPath, "utf8");
    const mdSource = path.relative(repoRoot, mdPath).replace(/\\/g, "/");
    for (const reference of extractImageReferences(content)) {
      const resolved = resolveImageReference({
        ...reference,
        mdPath,
        repoRoot,
        docsRoot,
      });
      if (!resolved || !IMAGE_EXTENSION_RE.test(resolved.absolute)) continue;
      const existing = references.get(resolved.key) ?? {
        absolute: resolved.absolute,
        sources: new Set(),
      };
      existing.sources.add(mdSource);
      references.set(resolved.key, existing);
    }
  }
  return references;
}
