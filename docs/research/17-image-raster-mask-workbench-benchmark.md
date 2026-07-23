# Image Raster Mask workbench benchmark

> Generated with `pnpm --filter @anno/web mask:bench` against the local Vite development server.

## Outcome

The 1080p browser gate passes for the supported non-tiled editor:

- decode and topology analysis run in a dedicated Worker; their wall time does not create a main-thread long task;
- main-thread bitmap construction stayed below 50 ms in every measured scenario (`p95 <= 41.60 ms`);
- a mixed 20-Mask working set retains about 113 MiB, below the 128 MiB default cache budget;
- browser heap returned to the pre-run value after warmup and all generated bitmaps were closed;
- the cache also has deterministic tests for byte-budget eviction, task-scope reset, late-result disposal and exactly-once bitmap close.

Dense full-frame masks retain about 9.89 MiB each. Twenty simultaneously visible dense masks exceed the default budget; active records are intentionally not evicted because doing so would cause reload thrash. Such a dataset remains supported, but the active working set can temporarily exceed the cache budget and should be inspected before raising the 4096-pixel editor limit.

## 1080p measurements

All times are milliseconds. Worker total includes module startup, decode, analysis and transfer. Pipeline includes Worker total plus main-thread bitmap construction.

| Fixture          |      Area | Components | Holes | Decode p50 / p95 | Analyze p50 / p95 | Worker p50 / p95 | Bitmap p50 / p95 | Pipeline p50 / p95 |
| ---------------- | --------: | ---------: | ----: | ---------------: | ----------------: | ---------------: | ---------------: | -----------------: |
| Sparse           |    99,468 |          1 |     0 |      2.10 / 2.40 |     53.70 / 57.30 |    67.40 / 70.50 |      3.70 / 5.30 |      71.10 / 75.90 |
| Dense            | 2,073,600 |          1 |     0 |    12.00 / 13.10 |     47.80 / 57.60 |    74.00 / 86.70 |    36.80 / 41.60 |    115.40 / 124.70 |
| Hole             |   933,120 |          1 |     1 |      8.90 / 9.60 |   100.20 / 111.60 |  120.20 / 135.00 |    19.10 / 19.80 |    139.40 / 155.00 |
| Three components |   220,816 |          3 |     0 |      4.20 / 4.20 |     72.40 / 79.80 |    90.00 / 97.70 |    15.00 / 18.10 |    107.00 / 114.80 |

The analysis values above exceed 50 ms for topology-heavy masks, which is why production has no silent synchronous fallback: decode, AABB, area, components, holes and boundary analysis stay inside the Worker. The only measured main-thread stage is bitmap creation, and its maximum was 41.60 ms.

## Memory accounting

The cache budget uses an explicit retained-byte estimate:

```text
cropped alpha bytes + cropped bitmap RGBA bytes = cropPixels * 5
```

The benchmark's conservative temporary upper bound is:

```text
full decoded alpha + cropped alpha + RGBA/bitmap transfer surfaces = fullPixels + cropPixels * 6
```

| Fixture          | Retained bytes / Mask | Temporary upper bound |
| ---------------- | --------------------: | --------------------: |
| Sparse           |               497,340 |             2,670,408 |
| Dense            |            10,368,000 |            14,515,200 |
| Hole             |             5,080,320 |             8,169,984 |
| Three components |             7,745,780 |            11,368,536 |

Five masks of each fixture produce a 20-Mask working set of `118,457,200` bytes. Chromium reported `24,500,000` used JS heap bytes before and after the run; the measured delta was zero.

## Reproduction metadata

- Date: 2026-07-21
- Resolution: 1920 x 1080
- Warmup: 2 iterations
- Samples: 7 iterations per fixture
- Node: v22.23.1
- Browser: headless Chromium
- OS: Linux 5.15.0-185-generic
- CPU: Intel Xeon Gold 6238R @ 2.20 GHz
- Raw data: [`data/17-image-raster-mask-workbench-benchmark.json`](./data/17-image-raster-mask-workbench-benchmark.json)
