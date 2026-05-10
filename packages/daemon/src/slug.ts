import { openSync, readSync, closeSync, statSync } from "node:fs";

// Cap the bytes scanned per call so a multi-MB transcript with no slug yet
// (early in a session) does not stall the event loop on every /pending.
const SCAN_CAP_BYTES = 64 * 1024;

export class SlugExtractor {
  private cache = new Map<string, string>();

  extract(sessionId: string, transcriptPath: string): string | null {
    const cached = this.cache.get(sessionId);
    if (cached !== undefined) return cached;
    const found = scanJsonlForSlug(transcriptPath);
    if (found !== null) this.cache.set(sessionId, found);
    return found;
  }

  /** Test/maintenance hook — drops any cached slug for the given session. */
  forget(sessionId: string): void {
    this.cache.delete(sessionId);
  }
}

function scanJsonlForSlug(path: string): string | null {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return null;
  }
  try {
    const size = statSync(path).size;
    const len = Math.min(size, SCAN_CAP_BYTES);
    const buf = Buffer.alloc(len);
    if (len > 0) readSync(fd, buf, 0, len, 0);
    const raw = buf.toString("utf8");
    // Drop a partial trailing line so JSON.parse doesn't see a half line.
    const lastNewline = raw.lastIndexOf("\n");
    const usable = lastNewline >= 0 ? raw.slice(0, lastNewline) : raw;
    for (const line of usable.split("\n")) {
      if (!line) continue;
      let obj: unknown;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      if (
        obj &&
        typeof obj === "object" &&
        typeof (obj as { slug?: unknown }).slug === "string"
      ) {
        const slug = (obj as { slug: string }).slug;
        if (slug.length > 0) return slug;
      }
    }
    return null;
  } finally {
    try {
      closeSync(fd);
    } catch {
      // ignore
    }
  }
}
