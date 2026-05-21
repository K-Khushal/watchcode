import { readFileSync, statSync } from "node:fs";
import { dirname, join, parse as parsePath } from "node:path";
import type { Logger } from "./logger.js";

/**
 * Walks upward from `cwd` to the filesystem root looking for `.watchcode.json`
 * and returns its `name` field. The found path + mtime are cached per `cwd`
 * so repeated approvals from the same session do not re-walk the tree on disk.
 *
 * Cache invalidation:
 *   - Stat the cached file's path; if mtime changed → re-read + re-walk.
 *   - If the cached file no longer exists → restart the upward walk.
 *
 * A `null` lookup (no file anywhere upward) is intentionally NOT cached.
 * Caching "absent" would silently ignore a `.watchcode.json` added later in
 * the session, which is exactly the kind of papercut this slice is meant to
 * avoid. The walk itself is bounded by path depth and cheap.
 */
// Hard cap on .watchcode.json size so a malicious or accidentally huge file
// in any ancestor directory cannot stall the event loop or balloon memory
// on every `POST /pending`. The schema is tiny ({"name": "..."}); 16 KiB is
// already orders of magnitude beyond any legitimate use.
const MAX_FILE_BYTES = 16 * 1024;

interface CacheEntry {
  file: string;
  mtimeMs: number;
  size: number;
  ino: number;
  name: string;
}

export class ProjectNameResolver {
  private cache = new Map<string, CacheEntry>();

  constructor(private logger?: Logger) {}

  resolve(cwd: string): string | null {
    const cached = this.cache.get(cwd);
    if (cached) {
      try {
        const st = statSync(cached.file);
        // mtime alone is insufficient — many filesystems have ≥1s mtime
        // granularity, so two writes within the same second can be aliased.
        // Combine mtime + size + inode to detect both content changes and
        // file-replacement (e.g. atomic rename of a new file over the old).
        if (
          st.mtimeMs === cached.mtimeMs &&
          st.size === cached.size &&
          st.ino === cached.ino
        ) {
          return cached.name;
        }
      } catch {
        // File vanished — fall through to fresh walk.
      }
      this.cache.delete(cwd);
    }

    const found = walkUpward(cwd, this.logger);
    if (!found) return null;
    this.cache.set(cwd, found);
    return found.name;
  }
}

function walkUpward(start: string, logger?: Logger): CacheEntry | null {
  const { root } = parsePath(start);
  let dir = start;
  // Hard cap on iterations as a belt-and-braces guard against pathological
  // paths or symlink loops — `path.parse(...).root` should terminate the walk
  // naturally, but defense in depth costs nothing.
  for (let i = 0; i < 256; i++) {
    const candidate = join(dir, ".watchcode.json");
    const result = tryRead(candidate, logger);
    if (result) return result;
    if (dir === root) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

function tryRead(file: string, logger?: Logger): CacheEntry | null {
  let st: ReturnType<typeof statSync>;
  try {
    st = statSync(file);
  } catch (err) {
    // ENOENT is the hot path ("no override here") and intentionally silent.
    // EACCES / EIO and other unexpected errors are warned so the user can
    // see why their `.watchcode.json` is being ignored.
    const code = (err as NodeJS.ErrnoException).code;
    if (code && code !== "ENOENT") {
      logger?.warn("project_name: stat failed", { file, code });
    }
    return null;
  }
  // Refuse anything that isn't a regular file — reading from a FIFO, socket
  // or device node could block the daemon's event loop indefinitely.
  if (!st.isFile()) {
    logger?.warn("project_name: not a regular file, ignoring", { file });
    return null;
  }
  if (st.size > MAX_FILE_BYTES) {
    logger?.warn("project_name: file exceeds size cap, ignoring", {
      file,
      size: st.size,
      cap: MAX_FILE_BYTES,
    });
    return null;
  }

  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    logger?.warn("project_name: read failed", { file, code });
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    logger?.warn("project_name: invalid JSON, ignoring", {
      file,
      err: (err as Error).message,
    });
    return null;
  }
  if (!parsed || typeof parsed !== "object") {
    logger?.warn("project_name: JSON is not an object", { file });
    return null;
  }
  const name = (parsed as { name?: unknown }).name;
  if (typeof name !== "string" || name.length === 0) {
    logger?.warn("project_name: missing or invalid 'name' field", { file });
    return null;
  }
  return { file, mtimeMs: st.mtimeMs, size: st.size, ino: st.ino, name };
}
