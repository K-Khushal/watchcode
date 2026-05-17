import { homedir } from "node:os";
import { join } from "node:path";
import { Queue } from "./queue.js";
import { createFileLogger } from "./logger.js";
import { startServer, RunningServer } from "./server.js";
import { writePidFile, removePidFile } from "./pidfile.js";
import { publishMdns } from "./mdns.js";

export interface StartDaemonOptions {
  port?: number;
  host?: string;
  homeDir?: string;
}

export async function startDaemon(opts: StartDaemonOptions = {}): Promise<RunningServer> {
  const home = opts.homeDir ?? join(homedir(), ".watchcode");
  const configPath = join(home, "config.json");
  const logger = createFileLogger(join(home, "logs", "daemon.log"));
  const queue = new Queue();
  const pidPath = join(home, "daemon.pid");

  // Bind the port BEFORE writing the pid file so a failed bind never leaves a
  // stale pid pointing at a non-listening process.
  // Default to 0.0.0.0 so the Galaxy Watch can reach /pair/complete and /ws
  // over LAN.  Loopback-only routes (POST /pending, etc.) remain protected by
  // the isLoopback guard inside server.ts.
  const host = opts.host ?? "0.0.0.0";
  const running = await startServer({ queue, logger, port: opts.port, host, configPath });
  writePidFile(pidPath);

  const mdns = publishMdns("watchcode", running.port);
  logger.info("mdns_published", { port: running.port });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("shutdown", { signal });
    mdns.stop();
    // Hard-deadline: if close() hangs, force-exit so the daemon is never
    // unkillable except by SIGKILL.
    const force = setTimeout(() => process.exit(1), 5_000);
    force.unref?.();
    running.close().finally(() => {
      removePidFile(pidPath);
      clearTimeout(force);
      process.exit(0);
    });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  return running;
}

// When invoked directly (spawned by CLI), start the daemon.
// `WATCHCODE_HOST=0.0.0.0` lets a LAN-attached watch reach the daemon during
// slice-3 testing; the WS upgrade has no auth yet (slice 4 adds HMAC), so this
// flag is opt-in and should only be set on a trusted network.
const isEntry = import.meta.url === `file://${process.argv[1]}`;
if (isEntry) {
  // Reject a non-numeric WATCHCODE_PORT rather than passing NaN through to
  // `server.listen`, which fails with a less obvious error.
  const portParsed = Number.parseInt(process.env.WATCHCODE_PORT ?? "", 10);
  startDaemon({
    host: process.env.WATCHCODE_HOST,
    port: Number.isFinite(portParsed) ? portParsed : undefined,
  }).catch((err) => {
    console.error("daemon failed to start:", err);
    process.exit(1);
  });
}

export { Queue } from "./queue.js";
export * from "./logger.js";
export * from "./pidfile.js";
export * from "./server.js";
export * from "./rules.js";
export * from "./slug.js";
export * from "./wsHub.js";
