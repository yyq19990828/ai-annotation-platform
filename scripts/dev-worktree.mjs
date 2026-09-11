#!/usr/bin/env node

import { spawn } from "node:child_process";
import { link, mkdir, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { createServer, connect } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(scriptPath), "..");
const host = "127.0.0.1";
const defaultApiPort = 8100;
const defaultWebPort = 3100;
const defaultScanLimit = 512;
const userScope = String(
  typeof process.getuid === "function" ? process.getuid() : (process.env.USERNAME ?? "user"),
).replaceAll(/[^a-zA-Z0-9_.-]/g, "_");
const defaultLockRoot = join(tmpdir(), `aap-dev-ports-${userScope}`);

const delay = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

function parsePort(raw, option) {
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${option} 必须是 1–65535 之间的整数`);
  }
  return port;
}

export function parseArguments(argv) {
  const options = {
    apiPort: defaultApiPort,
    webPort: defaultWebPort,
    skipMigrations: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (argument === "--skip-migrations") {
      options.skipMigrations = true;
      continue;
    }

    const [name, inlineValue] = argument.split("=", 2);
    if (name === "--api-port" || name === "--web-port") {
      const value = inlineValue ?? argv[index + 1];
      if (inlineValue === undefined) index += 1;
      if (!value || value === "--") throw new Error(`${name} 缺少端口值`);
      const key = name === "--api-port" ? "apiPort" : "webPort";
      options[key] = parsePort(value, name);
      continue;
    }

    throw new Error(`未知参数：${argument}`);
  }

  return options;
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function lockPathFor(lockRoot, port) {
  return join(lockRoot, `${port}.lock`);
}

async function createExclusiveLock(lockPath, owner) {
  const temporaryPath = `${lockPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(owner)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  try {
    await link(temporaryPath, lockPath);
    return true;
  } catch (error) {
    if (error?.code === "EEXIST") return false;
    throw error;
  } finally {
    await unlink(temporaryPath).catch(() => {});
  }
}

async function discardStaleLock(lockPath) {
  let owner;
  try {
    owner = JSON.parse(await readFile(lockPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    return false;
  }
  if (processIsAlive(owner?.pid)) return false;
  try {
    await unlink(lockPath);
    return true;
  } catch (error) {
    return error?.code === "ENOENT";
  }
}

export function isPortAvailable(port, listenHost = host) {
  return new Promise((resolveAvailability) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolveAvailability(false));
    server.listen({ host: listenHost, port, exclusive: true }, () => {
      server.close(() => resolveAvailability(true));
    });
  });
}

export async function reserveAvailablePort({
  startPort,
  lockRoot = defaultLockRoot,
  listenHost = host,
  scanLimit = defaultScanLimit,
  worktree = repositoryRoot,
}) {
  parsePort(startPort, "startPort");
  await mkdir(lockRoot, { recursive: true, mode: 0o700 });

  for (let offset = 0; offset < scanLimit && startPort + offset <= 65_535; offset += 1) {
    const port = startPort + offset;
    const lockPath = lockPathFor(lockRoot, port);
    const token = randomUUID();
    const owner = {
      pid: process.pid,
      token,
      worktree,
      createdAt: new Date().toISOString(),
    };

    let ownsLock = await createExclusiveLock(lockPath, owner);
    if (!ownsLock && (await discardStaleLock(lockPath))) {
      ownsLock = await createExclusiveLock(lockPath, owner);
    }
    if (!ownsLock) continue;

    if (!(await isPortAvailable(port, listenHost))) {
      await unlink(lockPath).catch(() => {});
      continue;
    }

    let released = false;
    const releaseSync = () => {
      if (released || !existsSync(lockPath)) return;
      try {
        const currentOwner = JSON.parse(readFileSync(lockPath, "utf8"));
        if (currentOwner.token === token) unlinkSync(lockPath);
      } catch {
        // A best-effort exit handler must never mask the process exit.
      }
      released = true;
    };
    const release = async () => {
      if (released) return;
      try {
        const currentOwner = JSON.parse(await readFile(lockPath, "utf8"));
        if (currentOwner.token === token) await unlink(lockPath);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      } finally {
        released = true;
        await rmdir(lockRoot).catch(() => {});
      }
    };

    return { port, release, releaseSync };
  }

  throw new Error(`从 ${startPort} 开始未找到可用端口（最多检查 ${scanLimit} 个）`);
}

function canConnect(port) {
  return new Promise((resolveConnection) => {
    const socket = connect({ host, port });
    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.destroy();
      resolveConnection(true);
    });
    const unavailable = () => {
      socket.destroy();
      resolveConnection(false);
    };
    socket.once("error", unavailable);
    socket.once("timeout", unavailable);
  });
}

function printHelp() {
  console.log(`用法：pnpm dev:worktree -- [选项]

同时启动当前 checkout 的 API 和 Web，并从指定起始值向上选取未使用端口。

选项：
  --api-port <port>      API 扫描起始端口（默认 ${defaultApiPort}）
  --web-port <port>      Web 扫描起始端口（默认 ${defaultWebPort}）
  --skip-migrations      不在启动 API 前执行 alembic upgrade head
  -h, --help             显示帮助`);
}

function spawnManaged(children, label, command, args, options) {
  const child = spawn(command, args, {
    ...options,
    detached: process.platform !== "win32",
    stdio: "inherit",
  });
  const managed = { child, label, done: false, result: undefined };
  managed.completion = new Promise((resolveCompletion) => {
    const settle = (result) => {
      if (managed.done) return;
      managed.done = true;
      managed.result = { label, ...result };
      children.delete(managed);
      resolveCompletion(managed.result);
    };
    child.once("error", (error) => settle({ code: null, signal: null, error }));
    child.once("exit", (code, signal) => settle({ code, signal, error: null }));
  });
  children.add(managed);
  return managed;
}

function signalManaged(managed, signal) {
  if (managed.done || !managed.child.pid) return;
  try {
    if (process.platform === "win32") managed.child.kill(signal === "SIGKILL" ? "SIGTERM" : signal);
    else process.kill(-managed.child.pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

async function stopChildren(children, signal = "SIGTERM") {
  const running = [...children];
  for (const managed of running) signalManaged(managed, signal);
  await Promise.race([Promise.all(running.map(({ completion }) => completion)), delay(3_000)]);

  const remaining = [...children];
  for (const managed of remaining) signalManaged(managed, "SIGKILL");
  await Promise.all(remaining.map(({ completion }) => completion));
}

async function waitForListening(managed, port, timeoutMilliseconds = 60_000) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (managed.done) {
      const detail = managed.result.error?.message ?? managed.result.signal ?? managed.result.code;
      throw new Error(`${managed.label} 在监听端口前退出：${detail}`);
    }
    if (await canConnect(port)) return;
    await delay(100);
  }
  throw new Error(`${managed.label} 未在 60 秒内监听 ${host}:${port}`);
}

export async function runDevWorktree(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    printHelp();
    return;
  }

  const children = new Set();
  const reservations = [];
  let shutdownRequested = false;
  let shutdownPromise;
  const releaseLocksOnExit = () => {
    for (const reservation of reservations) reservation.releaseSync();
  };
  const requestShutdown = (signal, exitCode) => {
    if (!shutdownRequested) {
      shutdownRequested = true;
      process.exitCode = exitCode;
      shutdownPromise = stopChildren(children, signal);
    }
    return shutdownPromise;
  };
  const onInterrupt = () => void requestShutdown("SIGINT", 130);
  const onTerminate = () => void requestShutdown("SIGTERM", 143);
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onTerminate);
  process.once("exit", releaseLocksOnExit);

  try {
    if (!options.skipMigrations) {
      console.log("[dev:worktree] 正在执行数据库迁移…");
      const migration = spawnManaged(
        children,
        "数据库迁移",
        "uv",
        ["run", "alembic", "upgrade", "head"],
        {
          cwd: join(repositoryRoot, "apps/api"),
          env: process.env,
        },
      );
      const result = await migration.completion;
      if (shutdownRequested) return;
      if (result.error || result.code !== 0) {
        throw result.error ?? new Error(`数据库迁移失败，退出码 ${result.code}`);
      }
    }

    const apiReservation = await reserveAvailablePort({
      startPort: options.apiPort,
      worktree: repositoryRoot,
    });
    reservations.push(apiReservation);
    const webReservation = await reserveAvailablePort({
      startPort: options.webPort,
      worktree: repositoryRoot,
    });
    reservations.push(webReservation);
    if (shutdownRequested) return;

    const apiPort = apiReservation.port;
    const webPort = webReservation.port;
    const apiTarget = `http://${host}:${apiPort}`;
    console.log(`[dev:worktree] ${basename(repositoryRoot)} 已分配 API ${apiPort}、Web ${webPort}`);

    const api = spawnManaged(
      children,
      "API",
      "uv",
      [
        "run",
        "uvicorn",
        "app.main:app",
        "--reload",
        "--host",
        host,
        "--port",
        String(apiPort),
        "--timeout-graceful-shutdown",
        "3",
      ],
      {
        cwd: join(repositoryRoot, "apps/api"),
        env: { ...process.env, MIGRATION_DATABASE_URL: "" },
      },
    );
    await waitForListening(api, apiPort);
    if (shutdownRequested) return;

    const web = spawnManaged(
      children,
      "Web",
      "pnpm",
      ["--filter", "@anno/web", "dev", "--host", host, "--port", String(webPort), "--strictPort"],
      {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          API_PROXY_TARGET: apiTarget,
          PORT: String(webPort),
        },
      },
    );
    await waitForListening(web, webPort);
    if (shutdownRequested) return;

    console.log(`\n[dev:worktree] 已就绪
  Web:      http://${host}:${webPort}
  API docs: ${apiTarget}/docs
  代理:     /api 和 /ws -> ${apiTarget}

按 Ctrl+C 同时停止两个服务。\n`);

    const exited = await Promise.race([api.completion, web.completion]);
    if (!shutdownRequested) {
      const detail = exited.error?.message ?? exited.signal ?? exited.code;
      throw new Error(`${exited.label} 意外退出：${detail}`);
    }
    await shutdownPromise;
  } catch (error) {
    if (!shutdownRequested) {
      process.exitCode = 1;
      console.error(`[dev:worktree] ${error.message}`);
      await stopChildren(children);
    }
  } finally {
    process.removeListener("SIGINT", onInterrupt);
    process.removeListener("SIGTERM", onTerminate);
    process.removeListener("exit", releaseLocksOnExit);
    await Promise.all(reservations.map(({ release }) => release()));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  await runDevWorktree();
}
