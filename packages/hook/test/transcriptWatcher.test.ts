import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  baselineSize,
  transcriptGrew,
} from "../src/transcriptWatcher.js";
import { HOOK_TRANSCRIPT_DELTA_BYTES } from "@watchcode/shared";

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wc-test-"));
  path = join(dir, "transcript.jsonl");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("transcriptWatcher", () => {
  it("baselineSize returns 0 when file does not exist", () => {
    expect(baselineSize(path)).toBe(0);
  });

  it("baselineSize matches file size", () => {
    writeFileSync(path, "x".repeat(50));
    expect(baselineSize(path)).toBe(50);
  });

  it("transcriptGrew false when growth below threshold", () => {
    writeFileSync(path, "x".repeat(50));
    const baseline = statSync(path).size;
    writeFileSync(
      path,
      "x".repeat(50 + HOOK_TRANSCRIPT_DELTA_BYTES - 1),
    );
    expect(transcriptGrew(path, baseline)).toBe(false);
  });

  it("transcriptGrew true when growth ≥ threshold", () => {
    writeFileSync(path, "x".repeat(50));
    const baseline = statSync(path).size;
    writeFileSync(
      path,
      "x".repeat(50 + HOOK_TRANSCRIPT_DELTA_BYTES),
    );
    expect(transcriptGrew(path, baseline)).toBe(true);
  });

  it("transcriptGrew false when file vanished mid-poll", () => {
    expect(transcriptGrew(path, 0)).toBe(false);
  });
});
