import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

export const PairedWatchSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  secret: z.string().regex(/^[0-9a-f]{64}$/),
  paired_at: z.string().datetime(),
  last_seen: z.string().datetime().nullable(),
  last_nonce: z.number().int().nonnegative(),
});

export const WatchcodeConfigSchema = z.object({
  watches: z.array(PairedWatchSchema),
});

export type PairedWatch = z.infer<typeof PairedWatchSchema>;
export type WatchcodeConfig = z.infer<typeof WatchcodeConfigSchema>;

export function readConfig(path: string): WatchcodeConfig {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { watches: [] };
  }
  if (!raw.trim()) return { watches: [] };
  return WatchcodeConfigSchema.parse(JSON.parse(raw));
}

export function writeConfig(path: string, cfg: WatchcodeConfig): void {
  WatchcodeConfigSchema.parse(cfg);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cfg, null, 2), "utf8");
}

export function findWatch(cfg: WatchcodeConfig, id: string): PairedWatch | undefined {
  return cfg.watches.find((w) => w.id === id);
}

export function addWatch(path: string, cfg: WatchcodeConfig, watch: PairedWatch): void {
  cfg.watches.push(watch);
  writeConfig(path, cfg);
}

export function removeWatch(path: string, cfg: WatchcodeConfig, name: string): boolean {
  const before = cfg.watches.length;
  cfg.watches = cfg.watches.filter((w) => w.name !== name);
  if (cfg.watches.length === before) return false;
  writeConfig(path, cfg);
  return true;
}

/**
 * Persist an advanced nonce for a single watch. Re-reads the config from disk
 * each time so that concurrent nonce updates from multiple authenticated
 * sockets do not clobber each other (avoids a TOCTOU race where each socket
 * holds a stale in-memory snapshot and the last writer wins).
 *
 * Called after every verified inbound WS message so replay protection survives
 * a daemon restart.
 */
export function updateWatchNonce(
  path: string,
  watchId: string,
  newNonce: number,
): void {
  const cfg = readConfig(path);
  const watch = cfg.watches.find((w) => w.id === watchId);
  if (!watch) return;
  watch.last_nonce = newNonce;
  writeConfig(path, cfg);
}
