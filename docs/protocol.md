# WatchCode Wire Protocol

This document is the frozen reference for the wire protocol between the
hook subprocess, daemon, and watch. It mirrors the Zod schemas in
`packages/shared/src/protocol.ts` and the HTTP routes in
`packages/daemon/src/server.ts`.

## HTTP API (loopback only, `127.0.0.1:9876`)

The daemon binds exclusively to the loopback interface and rejects any
non-loopback origin at the request layer (defense in depth on top of the
bind itself).

### `POST /pending`

Body:

```json
{
  "session_id": "...",
  "transcript_path": "/abs/path/to/transcript.jsonl",
  "cwd": "/abs/path/to/project",
  "tool_name": "Bash",
  "tool_input": { "command": "echo hi" }
}
```

Response `200`:

```json
{ "id": "<uuid>", "permissionRules": ["Bash(echo hi)"] }
```

The daemon constructs the title and the `permissionRules` array. The hook
relays the daemon's decision; it never builds rules itself.

### `GET /pending/:id/decision?wait=<ms>`

Long-poll. The daemon holds the request open until the request resolves
or `wait` milliseconds elapse (capped at `25000`).

| Status | Meaning |
| --- | --- |
| `200 { kind, permissionRules? }` | Decision available. `kind ∈ {approve, always, deny}`. |
| `204` | Wait elapsed, still pending. Hook should re-poll. |
| `404` | Resolved by local response. Hook should exit silently. |

### `POST /pending/:id/decision`

Used by the watch (or `curl`, during the spike) to inject a decision.

Body:

```json
{ "decision": "always", "permissionRules": ["Bash(echo hi)"] }
```

`decision` is required and one of `approve`, `always`, `deny`. When
`always` is supplied without `permissionRules`, the daemon falls back to
the rules it computed at enqueue time. Returns `204` on first resolve,
`409` if already resolved (idempotent). Returns `404` for unknown id.

### `POST /pending/:id/local-resolved`

The hook fires this when it detects the user used the native terminal
dialog (transcript grew ≥ 100 bytes). Idempotent. Returns `204`.

### `GET /status`

Returns a snapshot for `watchcode status`:

```json
{
  "daemon_pid": 1234,
  "version": "0.0.0",
  "pending": [{ "id": "...", "session_id": "...", "tool_name": "Bash", "title": "...", "createdAt": 1700000000000 }]
}
```

## Hook stdout (Claude Code contract)

For an `approve` outcome:

```json
{ "hookSpecificOutput": { "hookEventName": "PermissionRequest", "decision": { "behavior": "allow" } } }
```

For an `always` outcome:

```json
{ "hookSpecificOutput": { "hookEventName": "PermissionRequest", "decision": { "behavior": "allow", "permissionRules": ["Bash(echo hi)"] } } }
```

For a `deny` outcome:

```json
{ "hookSpecificOutput": { "hookEventName": "PermissionRequest", "decision": { "behavior": "deny" } } }
```

For local-resolved or any failure mode (daemon down, malformed input,
timeout): the hook exits `0` with **empty stdout** so Claude Code's
native dialog handles the request unchanged.

## `permissionRules` grammar (Slice 2 spike)

Per the Claude Code hooks documentation and the cc-remote-approval
reference implementation, the supported rule grammar in v1 is:

| Tool | Rule |
| --- | --- |
| `Bash` | `Bash(<exact command>)` |
| `Edit` | `Edit(<file_path>)` |
| `Write` | `Write(<file_path>)` |
| `WebFetch` | `WebFetch(<url>)` |
| any other | `<ToolName>` (bare — matches all uses of the tool) |

Rules must be byte-equal to the user's input on subsequent identical
calls so Claude Code's matcher applies. We do not synthesize prefix or
glob matchers in v1.

If a required input field is missing (e.g. a `Bash` request with no
`command`), the daemon emits an empty rules array rather than a
malformed rule.

The empirical verification step (real `claude` session + curl-injected
`always`) is the slice's manual demo; if the live session reveals that
the grammar differs, this document is the canonical place to record the
correction.

## Wire protocol between daemon and watch

Defined in `packages/shared/src/protocol.ts`. HMAC fields on
`approval_request` are optional in Slice 2 and tightened in Slice 4.

## `.watchcode.json` project override (Slice 5)

On every `POST /pending`, the daemon walks upward from the request's `cwd`
toward the filesystem root looking for a file named `.watchcode.json`. The
first one found wins. Schema:

```json
{ "name": "Customer API" }
```

The `name` field — if it is a non-empty string — is broadcast on the
`approval_request` as `session.project_name`. Cache key is `cwd`; the
cached entry is invalidated whenever the file's `mtime` changes or the
file disappears. A null lookup is NOT cached, so adding a
`.watchcode.json` mid-session takes effect on the next approval.

### Watch heading priority

The watch displays the first non-null value of:

1. `session.project_name` (`.watchcode.json` override)
2. `session.slug` (Claude Code transcript slug)
3. `session.cwd_basename` (fallback)

When `project_name` is present it fully replaces the slug/cwd pill — both
become irrelevant for display purposes.

## Multi-session / multi-watch behavior (Slice 5)

- The daemon's `Queue` keys entries by request id (UUID), not by
  `session_id`. Concurrent `claude` sessions therefore coexist as
  independent queue entries with distinct `session.slug` /
  `session.cwd_basename` / `session.project_name` labels.
- `approval_request` is broadcast to every open WebSocket client. With
  multiple paired watches online, all of them buzz and display the same
  card.
- `Queue.resolve(id, ...)` is idempotent: the first valid decision wins,
  any subsequent decision for the same id returns `409 already resolved`
  on the HTTP layer and is silently dropped on the WS path. The daemon
  emits one `approval_resolved` broadcast on the winning decision so
  every other watch can auto-dismiss its copy of the card.
