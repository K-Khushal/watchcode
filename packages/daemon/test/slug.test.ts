import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SlugExtractor } from "../src/slug.js";

const writeJsonl = (lines: object[]): string => {
  const dir = mkdtempSync(join(tmpdir(), "wc-slug-"));
  const p = join(dir, "transcript.jsonl");
  writeFileSync(p, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return p;
};

describe("SlugExtractor", () => {
  it("returns slug from first entry that has one", () => {
    const path = writeJsonl([
      { type: "queue-operation" },
      { type: "assistant", slug: "inherited-napping-eagle" },
      { type: "assistant", slug: "second-slug-ignored" },
    ]);
    const sx = new SlugExtractor();
    expect(sx.extract("s1", path)).toBe("inherited-napping-eagle");
  });

  it("returns null when no entry has a slug", () => {
    const path = writeJsonl([
      { type: "queue-operation" },
      { type: "system" },
    ]);
    const sx = new SlugExtractor();
    expect(sx.extract("s1", path)).toBeNull();
  });

  it("caches positive slug per session_id (does not re-read file)", () => {
    const path = writeJsonl([{ slug: "first-slug" }]);
    const sx = new SlugExtractor();
    expect(sx.extract("s1", path)).toBe("first-slug");
    // Truncate the file — a re-read would now return null.
    writeFileSync(path, "");
    expect(sx.extract("s1", path)).toBe("first-slug");
  });

  it("re-scans when previous result was null (slug may appear later)", () => {
    const path = writeJsonl([{ type: "queue-operation" }]);
    const sx = new SlugExtractor();
    expect(sx.extract("s1", path)).toBeNull();
    appendFileSync(path, JSON.stringify({ slug: "late-slug" }) + "\n");
    expect(sx.extract("s1", path)).toBe("late-slug");
  });

  it("survives malformed JSONL lines", () => {
    const dir = mkdtempSync(join(tmpdir(), "wc-slug-"));
    const p = join(dir, "t.jsonl");
    writeFileSync(p, '{"bad json\n{"slug":"good-one"}\n');
    const sx = new SlugExtractor();
    expect(sx.extract("s1", p)).toBe("good-one");
  });

  it("returns null when transcript file is missing", () => {
    const sx = new SlugExtractor();
    expect(sx.extract("s1", "/no/such/path.jsonl")).toBeNull();
  });
});
