import assert from "node:assert/strict";
import test from "node:test";
import { classifyMedia } from "./media-review-lib.mjs";

test("missing media is broken", () => {
  assert.equal(
    classifyMedia({
      exists: false,
      currentHash: null,
      review: null,
      changedPaths: [],
      ageDays: 0,
      maxAgeDays: 30,
    }).status,
    "broken",
  );
});

test("unreviewed media is review due", () => {
  assert.equal(
    classifyMedia({
      exists: true,
      currentHash: "abc",
      review: null,
      changedPaths: [],
      ageDays: 0,
      maxAgeDays: 30,
    }).status,
    "review_due",
  );
});

test("hash or watched source change makes a review stale", () => {
  assert.equal(
    classifyMedia({
      exists: true,
      currentHash: "new",
      review: { sha256: "old" },
      changedPaths: ["apps/web/src/example.tsx"],
      ageDays: 1,
      maxAgeDays: 30,
    }).status,
    "stale",
  );
});

test("unchanged recent review is current", () => {
  assert.equal(
    classifyMedia({
      exists: true,
      currentHash: "same",
      review: { sha256: "same" },
      changedPaths: [],
      ageDays: 3,
      maxAgeDays: 30,
    }).status,
    "current",
  );
});
