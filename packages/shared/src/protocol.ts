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
  // ApprovalRequest is a daemon→watch broadcast; the watch does not sign it.
  // These fields are kept optional for forward-compat but are never set today.
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

// watch → daemon. HMAC fields are required in slice 4 (unauthenticated
// approval responses are rejected via the manual guard in wsHub before this
// schema even applies, but making them required here closes the type gap).
export const ApprovalResponseMsg = z.object({
  type: z.literal("approval_response"),
  request_id: z.string().uuid(),
  decision: z.enum(["approve", "always", "deny"]),
  nonce: z.number().int().nonnegative(),
  hmac: z.string().regex(/^[0-9a-f]{64}$/),
});

export type ApprovalRequest = z.infer<typeof ApprovalRequestMsg>;
export type ApprovalResolved = z.infer<typeof ApprovalResolvedMsg>;
export type DaemonStatus = z.infer<typeof DaemonStatusMsg>;
export type ApprovalResponse = z.infer<typeof ApprovalResponseMsg>;

// Slice 4: first WS frame from watch — must arrive within 5s of connect.
export const ClientHelloMsg = z.object({
  type: z.literal("client_hello"),
  watch_id: z.string().uuid(),
  protocol_version: z.number().int().positive(),
  nonce: z.number().int().nonnegative(),
  hmac: z.string().regex(/^[0-9a-f]{64}$/),
});

export type ClientHello = z.infer<typeof ClientHelloMsg>;

export type DecisionKind = "approve" | "always" | "deny";

export interface DaemonDecision {
  kind: DecisionKind;
  permissionRules?: string[];
}
