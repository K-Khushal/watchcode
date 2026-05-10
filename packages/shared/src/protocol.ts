import { z } from "zod";

export const SessionInfo = z.object({
  id: z.string(),
  slug: z.string().nullable(),
  cwd_basename: z.string(),
});

export const ToolInfo = z.object({
  name: z.string(),
  title: z.string(),
  body: z.string(),
  raw_input: z.record(z.unknown()),
});

export const ApprovalRequestMsg = z.object({
  type: z.literal("approval_request"),
  id: z.string().uuid(),
  session: SessionInfo,
  tool: ToolInfo,
  timestamp: z.string(),
  // HMAC fields are optional in slice 2; tightened in slice 4.
  nonce: z.number().int().nonnegative().optional(),
  hmac: z.string().regex(/^[0-9a-f]{64}$/).optional(),
});

export const ApprovalResolvedMsg = z.object({
  type: z.literal("approval_resolved"),
  request_id: z.string().uuid(),
  resolved_by: z.enum(["watch", "local"]),
  decision: z.enum(["approve", "always", "deny", ""]),
});

export const DaemonStatusMsg = z.object({
  type: z.literal("daemon_status"),
  active_sessions: z.number().int().nonnegative(),
  pending_count: z.number().int().nonnegative(),
  version: z.string(),
});

export type ApprovalRequest = z.infer<typeof ApprovalRequestMsg>;
export type ApprovalResolved = z.infer<typeof ApprovalResolvedMsg>;
export type DaemonStatus = z.infer<typeof DaemonStatusMsg>;

export type DecisionKind = "approve" | "always" | "deny";

export interface DaemonDecision {
  kind: DecisionKind;
  permissionRules?: string[];
}
