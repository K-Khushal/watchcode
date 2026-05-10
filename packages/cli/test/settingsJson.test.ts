import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeHookEntry, removeHookEntry, HOOK_COMMAND_MARKER } from "../src/settingsJson.js";

let dir: string;
let settingsPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wc-cli-"));
  settingsPath = join(dir, "settings.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const HOOK_CMD = "node /tmp/hook.js";

describe("settings.json merge", () => {
  it("creates settings.json with hook when file does not exist", () => {
    mergeHookEntry(settingsPath, HOOK_CMD);
    const obj = JSON.parse(readFileSync(settingsPath, "utf8"));
    const arr = obj.hooks.PermissionRequest;
    expect(arr).toHaveLength(1);
    expect(arr[0].matcher).toBe("");
    expect(arr[0].hooks[0].type).toBe("command");
    expect(arr[0].hooks[0].command).toBe(HOOK_CMD);
    expect(arr[0].hooks[0].timeout).toBe(259200);
  });

  it("preserves existing unrelated keys", () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({ theme: "dark", env: { FOO: "bar" } }),
    );
    mergeHookEntry(settingsPath, HOOK_CMD);
    const obj = JSON.parse(readFileSync(settingsPath, "utf8"));
    expect(obj.theme).toBe("dark");
    expect(obj.env.FOO).toBe("bar");
    expect(obj.hooks.PermissionRequest).toHaveLength(1);
  });

  it("idempotent: running twice does not duplicate hook entry", () => {
    mergeHookEntry(settingsPath, HOOK_CMD);
    mergeHookEntry(settingsPath, HOOK_CMD);
    const obj = JSON.parse(readFileSync(settingsPath, "utf8"));
    expect(obj.hooks.PermissionRequest).toHaveLength(1);
  });

  it("preserves other PermissionRequest hooks (different command)", () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          PermissionRequest: [
            { matcher: "Bash", hooks: [{ type: "command", command: "other-tool" }] },
          ],
        },
      }),
    );
    mergeHookEntry(settingsPath, HOOK_CMD);
    const obj = JSON.parse(readFileSync(settingsPath, "utf8"));
    const arr = obj.hooks.PermissionRequest;
    expect(arr).toHaveLength(2);
    expect(arr.some((e: any) => e.hooks[0].command === "other-tool")).toBe(true);
    expect(arr.some((e: any) => e.hooks[0].command === HOOK_CMD)).toBe(true);
  });

  it("removeHookEntry strips only watchcode hook", () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          PermissionRequest: [
            { matcher: "Bash", hooks: [{ type: "command", command: "other-tool" }] },
          ],
        },
      }),
    );
    mergeHookEntry(settingsPath, HOOK_CMD);
    removeHookEntry(settingsPath, HOOK_CMD);
    const obj = JSON.parse(readFileSync(settingsPath, "utf8"));
    expect(obj.hooks.PermissionRequest).toHaveLength(1);
    expect(obj.hooks.PermissionRequest[0].hooks[0].command).toBe("other-tool");
  });

  it("hook command contains the watchcode marker for safe identification", () => {
    expect(HOOK_COMMAND_MARKER).toMatch(/watchcode/);
  });

  it("does not write file if no change made (idempotent on second call)", () => {
    mergeHookEntry(settingsPath, HOOK_CMD);
    const before = readFileSync(settingsPath, "utf8");
    mergeHookEntry(settingsPath, HOOK_CMD);
    const after = readFileSync(settingsPath, "utf8");
    expect(after).toBe(before);
  });
});
