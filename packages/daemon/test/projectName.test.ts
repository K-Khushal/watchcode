import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, utimesSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProjectNameResolver } from "../src/projectName.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "wc-projname-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("ProjectNameResolver", () => {
  it("returns null when no .watchcode.json exists anywhere upward", () => {
    const deep = join(root, "a", "b", "c");
    mkdirSync(deep, { recursive: true });
    const r = new ProjectNameResolver();
    expect(r.resolve(deep)).toBeNull();
  });

  it("finds .watchcode.json at the project root from a deep subdir", () => {
    const deep = join(root, "src", "api", "handlers");
    mkdirSync(deep, { recursive: true });
    writeFileSync(
      join(root, ".watchcode.json"),
      JSON.stringify({ name: "Customer API" }),
    );
    const r = new ProjectNameResolver();
    expect(r.resolve(deep)).toBe("Customer API");
  });

  it("returns null when file exists but is missing a name field", () => {
    writeFileSync(join(root, ".watchcode.json"), JSON.stringify({ other: 1 }));
    const r = new ProjectNameResolver();
    expect(r.resolve(root)).toBeNull();
  });

  it("returns null when file is malformed JSON (does not throw)", () => {
    writeFileSync(join(root, ".watchcode.json"), "{not json");
    const r = new ProjectNameResolver();
    expect(r.resolve(root)).toBeNull();
  });

  it("warns (does not silently swallow) when .watchcode.json is malformed JSON", () => {
    writeFileSync(join(root, ".watchcode.json"), "{not json");
    const warns: Array<{ msg: string; meta?: Record<string, unknown> }> = [];
    const logger = {
      info: () => {},
      warn: (msg: string, meta?: Record<string, unknown>) => warns.push({ msg, meta }),
      error: () => {},
    };
    const r = new ProjectNameResolver(logger);
    expect(r.resolve(root)).toBeNull();
    expect(warns.some((w) => w.msg.includes("invalid JSON"))).toBe(true);
  });

  it("warns when 'name' field is missing or invalid", () => {
    writeFileSync(join(root, ".watchcode.json"), JSON.stringify({ name: 123 }));
    const warns: string[] = [];
    const logger = {
      info: () => {},
      warn: (msg: string) => warns.push(msg),
      error: () => {},
    };
    const r = new ProjectNameResolver(logger);
    expect(r.resolve(root)).toBeNull();
    expect(warns.some((m) => m.includes("missing or invalid 'name'"))).toBe(true);
  });

  it("returns null when name is empty string", () => {
    writeFileSync(join(root, ".watchcode.json"), JSON.stringify({ name: "" }));
    const r = new ProjectNameResolver();
    expect(r.resolve(root)).toBeNull();
  });

  it("uses the nearest .watchcode.json when nested", () => {
    const inner = join(root, "inner");
    mkdirSync(inner);
    writeFileSync(join(root, ".watchcode.json"), JSON.stringify({ name: "Outer" }));
    writeFileSync(join(inner, ".watchcode.json"), JSON.stringify({ name: "Inner" }));
    const r = new ProjectNameResolver();
    expect(r.resolve(inner)).toBe("Inner");
  });

  it("invalidates cache when content size changes even if mtime is preserved", () => {
    const file = join(root, ".watchcode.json");
    writeFileSync(file, JSON.stringify({ name: "X" }));
    const r = new ProjectNameResolver();
    expect(r.resolve(root)).toBe("X");
    // Grab original mtime, write a longer payload, then restore mtime.
    const origStat = statSync(file).mtimeMs / 1000;
    writeFileSync(file, JSON.stringify({ name: "MuchLongerProjectName" }));
    utimesSync(file, origStat, origStat);
    // Same mtime but different size → resolver MUST notice and re-read.
    expect(r.resolve(root)).toBe("MuchLongerProjectName");
  });

  it("rejects an oversized .watchcode.json (returns null)", () => {
    const file = join(root, ".watchcode.json");
    // 32 KiB > MAX_FILE_BYTES (16 KiB). Valid JSON with a giant name field.
    const huge = JSON.stringify({ name: "x".repeat(32 * 1024) });
    writeFileSync(file, huge);
    const r = new ProjectNameResolver();
    expect(r.resolve(root)).toBeNull();
  });

  it("re-resolves when .watchcode.json mtime changes", async () => {
    const file = join(root, ".watchcode.json");
    writeFileSync(file, JSON.stringify({ name: "First" }));
    const r = new ProjectNameResolver();
    expect(r.resolve(root)).toBe("First");
    // Bump mtime forward
    const future = Date.now() / 1000 + 10;
    writeFileSync(file, JSON.stringify({ name: "Second" }));
    utimesSync(file, future, future);
    expect(r.resolve(root)).toBe("Second");
  });

  it("re-resolves null if a previously-present .watchcode.json is removed", () => {
    const file = join(root, ".watchcode.json");
    writeFileSync(file, JSON.stringify({ name: "X" }));
    const r = new ProjectNameResolver();
    expect(r.resolve(root)).toBe("X");
    rmSync(file);
    expect(r.resolve(root)).toBeNull();
  });

  it("stops the walk at filesystem root (does not throw)", () => {
    // /tmp/... — guarantees we walk all the way to /
    const r = new ProjectNameResolver();
    // Should not throw on missing-everywhere lookup
    expect(r.resolve(root)).toBeNull();
  });
});
