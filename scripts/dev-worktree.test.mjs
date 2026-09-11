import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseArguments, reserveAvailablePort } from "./dev-worktree.mjs";

function listen(server, port = 0) {
  return new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen({ host: "127.0.0.1", port }, () => resolveListen(server.address().port));
  });
}

function close(server) {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
}

test("parses preferred ports and migration options", () => {
  assert.deepEqual(parseArguments([]), {
    apiPort: 8100,
    webPort: 3100,
    skipMigrations: false,
    help: false,
  });
  assert.deepEqual(
    parseArguments(["--", "--api-port", "8200", "--web-port=3200", "--skip-migrations"]),
    {
      apiPort: 8200,
      webPort: 3200,
      skipMigrations: true,
      help: false,
    },
  );
  assert.throws(() => parseArguments(["--api-port", "0"]), /1–65535/);
  assert.throws(() => parseArguments(["--unknown"]), /未知参数/);
});

test("skips a port already occupied by another process", async () => {
  const lockRoot = await mkdtemp(join(tmpdir(), "aap-dev-port-test-"));
  const blocker = createServer();
  const occupiedPort = await listen(blocker);
  let reservation;
  try {
    reservation = await reserveAvailablePort({
      startPort: occupiedPort,
      lockRoot,
      scanLimit: 32,
      worktree: "/test/occupied",
    });
    assert.notEqual(reservation.port, occupiedPort);
  } finally {
    await reservation?.release();
    await close(blocker);
    await rm(lockRoot, { recursive: true, force: true });
  }
});

test("serializes concurrent worktree reservations and releases the lock", async () => {
  const lockRoot = await mkdtemp(join(tmpdir(), "aap-dev-port-test-"));
  const probe = createServer();
  const startPort = await listen(probe);
  await close(probe);
  let first;
  let second;
  let reused;
  try {
    [first, second] = await Promise.all([
      reserveAvailablePort({ startPort, lockRoot, scanLimit: 32, worktree: "/test/a" }),
      reserveAvailablePort({ startPort, lockRoot, scanLimit: 32, worktree: "/test/b" }),
    ]);
    assert.notEqual(first.port, second.port);

    await first.release();
    reused = await reserveAvailablePort({
      startPort: first.port,
      lockRoot,
      scanLimit: 1,
      worktree: "/test/c",
    });
    assert.equal(reused.port, first.port);
  } finally {
    await first?.release();
    await second?.release();
    await reused?.release();
    await rm(lockRoot, { recursive: true, force: true });
  }
});

test("reclaims a lock left by a terminated launcher", async () => {
  const lockRoot = await mkdtemp(join(tmpdir(), "aap-dev-port-test-"));
  const probe = createServer();
  const startPort = await listen(probe);
  await close(probe);
  let reservation;
  try {
    await writeFile(
      join(lockRoot, `${startPort}.lock`),
      `${JSON.stringify({ pid: 2_147_483_647, token: "stale" })}\n`,
    );
    reservation = await reserveAvailablePort({
      startPort,
      lockRoot,
      scanLimit: 1,
      worktree: "/test/recovered",
    });
    assert.equal(reservation.port, startPort);
  } finally {
    await reservation?.release();
    await rm(lockRoot, { recursive: true, force: true });
  }
});
