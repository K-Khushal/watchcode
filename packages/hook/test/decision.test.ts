import { describe, it, expect } from "vitest";
import { toHookOutput, emitToStdout } from "../src/decision.js";
import type { DaemonDecision } from "@watchcode/shared";

describe("DecisionEmitter", () => {
  it("approve → behavior:allow with no permissionRules", () => {
    const out = toHookOutput({ kind: "approve" });
    expect(out).toEqual({
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "allow" },
      },
    });
  });

  it("always → behavior:allow with permissionRules", () => {
    const d: DaemonDecision = {
      kind: "always",
      permissionRules: ["Bash(echo hello)"],
    };
    const out = toHookOutput(d);
    expect(out.hookSpecificOutput.decision).toEqual({
      behavior: "allow",
      permissionRules: ["Bash(echo hello)"],
    });
  });

  it("deny → behavior:deny", () => {
    const out = toHookOutput({ kind: "deny" });
    expect(out.hookSpecificOutput.decision).toEqual({ behavior: "deny" });
  });

  it("emitToStdout writes exact JSON bytes (no trailing newline issues)", () => {
    const writes: string[] = [];
    const fakeWrite = (s: string) => {
      writes.push(s);
      return true;
    };
    emitToStdout({ kind: "approve" }, fakeWrite);
    expect(writes.length).toBe(1);
    expect(JSON.parse(writes[0]!)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "allow" },
      },
    });
  });
});
