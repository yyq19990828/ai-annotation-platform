#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../../..");
const defaultOutDir = resolve(repoRoot, "test-results/image-seeds");

function parseArgs(argv) {
  const args = {
    ids: [],
    list: false,
    outDir: defaultOutDir,
    verifyOnly: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (arg === "--id") {
      args.ids.push(argv[i + 1] ?? "");
      i += 1;
    } else if (arg === "--list") {
      args.list = true;
    } else if (arg === "--out") {
      args.outDir = resolve(argv[i + 1] ?? defaultOutDir);
      i += 1;
    } else if (arg === "--verify-only") {
      args.verifyOnly = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (args.ids.some((id) => !id)) throw new Error("--id requires a value");
  return args;
}

async function digestFile(path) {
  const handle = await open(path, "r");
  const digest = createHash("sha256");
  try {
    for await (const chunk of handle.createReadStream()) digest.update(chunk);
  } finally {
    await handle.close();
  }
  return digest.digest("hex");
}

async function verifyFile(path, seed) {
  try {
    const metadata = await stat(path);
    if (metadata.size !== seed.byteSize) return false;
    return (await digestFile(path)) === seed.sha256;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function removePartial(path) {
  try {
    await unlink(path);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function downloadSeed(seed, target) {
  const partial = `${target}.partial`;
  await removePartial(partial);
  const response = await fetch(seed.sourceUrl, {
    headers: {
      "User-Agent": "ai-annotation-platform-fixture-fetch/1",
    },
    redirect: "follow",
  });
  if (!response.ok || !response.body) {
    throw new Error(`${seed.id}: download failed (${response.status})`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) {
    throw new Error(`${seed.id}: unexpected content-type ${contentType}`);
  }

  const handle = await open(partial, "w", 0o600);
  const digest = createHash("sha256");
  let byteSize = 0;
  try {
    for await (const chunk of response.body) {
      const bytes = Buffer.from(chunk);
      byteSize += bytes.byteLength;
      if (byteSize > seed.byteSize) {
        throw new Error(`${seed.id}: response exceeds expected byte size`);
      }
      digest.update(bytes);
      await handle.write(bytes);
    }
  } catch (error) {
    await handle.close();
    await removePartial(partial);
    throw error;
  }
  await handle.close();

  const actualDigest = digest.digest("hex");
  if (byteSize !== seed.byteSize || actualDigest !== seed.sha256) {
    await removePartial(partial);
    throw new Error(`${seed.id}: integrity mismatch (bytes=${byteSize}, sha256=${actualDigest})`);
  }
  await rename(partial, target);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = JSON.parse(await readFile(resolve(scriptDir, "fixtures.json"), "utf8"));
  const seeds = config.realLargeImages ?? [];
  const selected = args.ids.length ? seeds.filter((seed) => args.ids.includes(seed.id)) : seeds;
  const missingIds = args.ids.filter((id) => !selected.some((seed) => seed.id === id));
  if (missingIds.length) {
    throw new Error(`Unknown seed id: ${missingIds.join(", ")}`);
  }

  if (args.list) {
    for (const seed of selected) {
      console.log(
        `${seed.id}\t${seed.widthPx}x${seed.heightPx}\t${seed.byteSize}\t${seed.filename}`,
      );
    }
    return;
  }

  await mkdir(args.outDir, { recursive: true });
  for (const seed of selected) {
    const target = resolve(args.outDir, seed.filename);
    if (await verifyFile(target, seed)) {
      console.log(`verified ${seed.id}: ${target}`);
      continue;
    }
    if (args.verifyOnly) {
      throw new Error(`${seed.id}: missing or integrity mismatch at ${target}`);
    }
    console.log(`downloading ${seed.id} from ${seed.sourcePage}`);
    await downloadSeed(seed, target);
    console.log(`verified ${seed.id}: ${target}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
