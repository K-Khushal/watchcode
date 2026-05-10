import type { DaemonDecision, HookOutput } from "@watchcode/shared";

export function toHookOutput(d: DaemonDecision): HookOutput {
  if (d.kind === "deny") {
    return {
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "deny" },
      },
    };
  }
  if (d.kind === "always") {
    return {
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: {
          behavior: "allow",
          permissionRules: d.permissionRules ?? [],
        },
      },
    };
  }
  return {
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: { behavior: "allow" },
    },
  };
}

export type Writer = (s: string) => boolean;

export function emitToStdout(
  d: DaemonDecision,
  write: Writer = (s) => process.stdout.write(s),
): void {
  write(JSON.stringify(toHookOutput(d)));
}
