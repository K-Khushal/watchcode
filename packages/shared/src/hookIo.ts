import { z } from "zod";

export const HookInput = z
  .object({
    hook_event_name: z.literal("PermissionRequest"),
    session_id: z.string(),
    transcript_path: z.string(),
    cwd: z.string(),
    tool_name: z.string(),
    tool_input: z.record(z.unknown()),
  })
  .passthrough();

const AllowDecision = z.object({
  behavior: z.literal("allow"),
  permissionRules: z.array(z.string()).optional(),
  updatedInput: z.record(z.unknown()).optional(),
});

const DenyDecision = z.object({
  behavior: z.literal("deny"),
  message: z.string().optional(),
});

export const HookOutput = z.object({
  hookSpecificOutput: z.object({
    hookEventName: z.literal("PermissionRequest"),
    decision: z.union([AllowDecision, DenyDecision]),
  }),
});

export type HookInput = z.infer<typeof HookInput>;
export type HookOutput = z.infer<typeof HookOutput>;
