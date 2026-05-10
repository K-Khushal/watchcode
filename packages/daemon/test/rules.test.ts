import { describe, it, expect } from "vitest";
import { buildPermissionRules } from "../src/rules.js";

describe("buildPermissionRules", () => {
  it("Bash → exact-command rule", () => {
    expect(
      buildPermissionRules("Bash", { command: "echo hello" }),
    ).toEqual(["Bash(echo hello)"]);
  });

  it("Edit → file_path rule", () => {
    expect(
      buildPermissionRules("Edit", { file_path: "/tmp/x.ts" }),
    ).toEqual(["Edit(/tmp/x.ts)"]);
  });

  it("Write → file_path rule", () => {
    expect(
      buildPermissionRules("Write", { file_path: "/tmp/y.ts" }),
    ).toEqual(["Write(/tmp/y.ts)"]);
  });

  it("WebFetch → url rule", () => {
    expect(
      buildPermissionRules("WebFetch", { url: "https://x.com" }),
    ).toEqual(["WebFetch(https://x.com)"]);
  });

  it("unknown tool → empty rule list (no over-broad bare-tool rule)", () => {
    expect(buildPermissionRules("Glob", { pattern: "*.ts" })).toEqual([]);
  });

  it("missing required field → empty rule list (no malformed rule)", () => {
    expect(buildPermissionRules("Bash", {})).toEqual([]);
  });

  it("rejects Bash command containing closing paren (would break grammar)", () => {
    expect(
      buildPermissionRules("Bash", { command: "echo $(date)" }),
    ).toEqual([]);
  });

  it("rejects Bash command containing newline", () => {
    expect(buildPermissionRules("Bash", { command: "echo a\necho b" })).toEqual([]);
  });
});
