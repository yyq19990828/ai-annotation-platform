import assert from "node:assert/strict";
import { test } from "vitest";

import { isVideoLifecycleCancellation } from "../e2e/helpers/video-request-errors";

const task = "/api/v1/tasks/00000000-0000-0000-0000-000000000000";
const video = "/api/v1/videos/00000000-0000-0000-0000-000000000000";
const abort = { kind: "request", message: "net::ERR_ABORTED" };

test("retiring a video owner may cancel both chunk metadata and samples", () => {
  for (const path of [`${video}/chunks/0`, `${video}/chunks/0/samples`])
    assert.equal(isVideoLifecycleCancellation({ ...abort, method: "GET", path }), true, path);
});

test("known preview and document lifecycle requests may be cancelled", () => {
  for (const path of [task, `${task}/video/frames/63`, "/api/v1/auth/me", "/api/v1/feedbacks"])
    assert.equal(isVideoLifecycleCancellation({ ...abort, method: "GET", path }), true, path);
  for (const path of ["/api/v1/auth/me/heartbeat", "/api/v1/auth/me/task-events:batch"])
    assert.equal(isVideoLifecycleCancellation({ ...abort, method: "POST", path }), true, path);
});

test("task queue cancellation is limited to the exact GET lifecycle request", () => {
  const request = { ...abort, method: "GET", path: "/api/v1/tasks" };
  assert.equal(isVideoLifecycleCancellation(request), true);
  assert.equal(isVideoLifecycleCancellation({ ...request, method: "POST" }), false);
  assert.equal(isVideoLifecycleCancellation({ ...request, kind: "http" }), false);
  assert.equal(
    isVideoLifecycleCancellation({ ...request, message: "net::ERR_CONNECTION_RESET" }),
    false,
  );
  assert.equal(isVideoLifecycleCancellation({ ...request, path: "/api/v1/tasks/export" }), false);
});

test("annotation and Issue writes never become expected cancellations", () => {
  for (const method of ["POST", "PATCH", "DELETE"])
    for (const path of [`${task}/annotations`, "/api/v1/annotations/a", "/api/v1/feedbacks"])
      assert.equal(
        isVideoLifecycleCancellation({ ...abort, method, path }),
        false,
        `${method} ${path}`,
      );
});

test("discussion tab cancellation permits only its exact GET read", () => {
  const request = { ...abort, method: "GET", path: `${task}/discussion/page` };
  assert.equal(isVideoLifecycleCancellation(request), true);
  for (const method of ["POST", "PATCH", "DELETE"])
    assert.equal(isVideoLifecycleCancellation({ ...request, method }), false);
  assert.equal(isVideoLifecycleCancellation({ ...request, kind: "http" }), false);
  assert.equal(
    isVideoLifecycleCancellation({ ...request, message: "net::ERR_CONNECTION_RESET" }),
    false,
  );
  assert.equal(
    isVideoLifecycleCancellation({ ...request, path: `${task}/discussion/page/export` }),
    false,
  );
});

test("HTTP failures, other network failures and unrelated endpoints remain errors", () => {
  const known = { ...abort, method: "GET", path: `${video}/chunks/0/samples` };
  assert.equal(isVideoLifecycleCancellation(known), true);
  assert.equal(isVideoLifecycleCancellation({ ...known, kind: "http" }), false);
  assert.equal(
    isVideoLifecycleCancellation({ ...known, message: "net::ERR_CONNECTION_RESET" }),
    false,
  );
  assert.equal(isVideoLifecycleCancellation({ ...known, method: "POST" }), false);
  for (const path of [`${video}/chunks/0/samples/retry`, `${task}/lock`, "/api/v1/projects"])
    assert.equal(isVideoLifecycleCancellation({ ...known, path }), false, path);
});
