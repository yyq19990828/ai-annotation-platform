import fs from "node:fs";
import { createHash } from "node:crypto";

export function normalizeScreenshotManifest(raw) {
  if (raw && raw.schema_version === 2 && raw.entries && typeof raw.entries === "object") {
    return { schemaVersion: 2, metadata: raw, entries: raw.entries };
  }
  return {
    schemaVersion: 1,
    metadata: { schema_version: 1 },
    entries: raw && typeof raw === "object" ? raw : {},
  };
}

export function readScreenshotManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    return normalizeScreenshotManifest({});
  }
  return normalizeScreenshotManifest(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
}

export function sha256File(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function readImageDimensions(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (
    buffer.length >= 24 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length >= 10 && ["GIF87a", "GIF89a"].includes(buffer.toString("ascii", 0, 6))) {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xc3) {
        return {
          width: buffer.readUInt16BE(offset + 7),
          height: buffer.readUInt16BE(offset + 5),
        };
      }
      if (length < 2) break;
      offset += 2 + length;
    }
  }
  throw new Error(`无法读取图片尺寸: ${filePath}`);
}
