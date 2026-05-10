import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/run.js";
import type { DaemonClient } from "../src/daemonClient.js";

let dir: string;
let transcript: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wc-run-"));
  transcript = join(dir, "t.jsonl");
  writeFileSync(transcript, "");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const stdinFor = (toolName = "Bash", toolInput: Record<string, unknown> = { command: "echo hi" }) =>
  JSON.stringify({
    hook_event_name: "PermissionRequest",
    session_id: "s1",
    transcript_path: transcript,
    cwd: dir,
    tool_name: toolName,
    tool_input: toolInput,
  });

const fakeSleep = () => Promise.resolve();

describe("hook run loop", () => {
  it("returns null on malformed stdin", async () => {
    const out = await run("not json");
    expect(out).toBeNull();
  });

  it("returns null on daemon connection refused", async () => {
    const client: DaemonClient = {
      enqueue: () => Promise.reject(new Error("ECONNREFUSED")),
      pollDecision: async () => null,
      markLocal: async () => {},
    };
    const out = await run(stdinFor(), { client, sleep: fakeSleep });
    expect(out).toBeNull();
  });

  it("returns hook output when daemon resolves with always", async () => {
    const client: DaemonClient = {
      enqueue: async () => ({ id: "abc" }),
      pollDecision: async () => ({ kind: "always", permissionRules: ["Bash(echo hi)"] }),
      markLocal: async () => {},
    };
    const out = await run(stdinFor(), { client, sleep: fakeSleep });
    expect(out).not.toBeNull();
    expect(out!.hookSpecificOutput.decision).toEqual({
      behavior: "allow",
      permissionRules: ["Bash(echo hi)"],
    });
  });

  it("returns null when daemon signals local resolution (404)", async () => {
    const client: DaemonClient = {
      enqueue: async () => ({ id: "abc" }),
      pollDecision: async () => "local",
      markLocal: async () => {},
    };
    const out = await run(stdinFor(), { client, sleep: fakeSleep });
    expect(out).toBeNull();
  });

  it("returns null and notifies daemon when transcript grows ≥100 bytes", async () => {
    let markCalls = 0;
    const client: DaemonClient = {
      enqueue: async () => {
        // Simulate transcript growth between enqueue and first poll.
        appendFileSync(transcript, "x".repeat(200));
        return { id: "abc" };
      },
      pollDecision: async () => null,
      markLocal: async () => {
        markCalls++;
      },
    };
    const out = await run(stdinFor(), { client, sleep: fakeSleep });
    expect(out).toBeNull();
    // Allow microtask flush
    await new Promise((r) => setTimeout(r, 5));
    expect(markCalls).toBe(1);
  });
});
