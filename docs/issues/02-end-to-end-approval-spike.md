# Slice 2 — End-to-end approval via curl-as-watch + permissionRules grammar spike

**Type:** AFK  
**GitHub:** [K-Khushal/watchcode#3](https://github.com/K-Khushal/watchcode/issues/3)  
**Status:** ready-for-agent

---

## Parent

#1

## What to build

The load-bearing slice that proves the parallel-hook architecture against real Claude Code. After this lands, the daemon, hook, and CLI cooperate end-to-end and a developer can demonstrate the full approval path using `curl` as a stand-in for the watch — no UI yet.

Scope:
- **`packages/shared`**: Zod schemas for the hook input/output (Claude Code's `PermissionRequest` JSON shape, see PRD §6 and #1) and a subset of the WS protocol — `ApprovalRequest`, `DaemonStatus`, `ApprovalResolved`. HMAC fields can be defined as optional now and tightened in slice 4. Constants: port `9876`, transcript-growth threshold `100` bytes, poll interval `1000ms`, hook timeout `259200` s, daemon long-poll max `25000ms`.
- **`packages/daemon`**: HTTP server on `127.0.0.1:9876` (loopback only) with endpoints `POST /pending`, `GET /pending/:id/decision` (long-poll up to 25s), `POST /pending/:id/local-resolved`, `GET /status`. In-memory `Queue` module with `enqueue`/`resolve` (idempotent) / `findByRequestId`. Logs to `~/.watchcode/logs/daemon.log`. Writes PID file to `~/.watchcode/daemon.pid`. SIGTERM/SIGINT graceful shutdown.
- **`packages/hook`**: stdin parser (Zod-validated), captures `transcript_path` baseline byte size, POSTs `/pending`, dual-poll loop — every 1s checks transcript file size against baseline (≥100-byte growth = local-response detected) AND long-polls `/pending/:id/decision`. On daemon decision: writes the appropriate `hookSpecificOutput.decision` JSON to stdout and exits 0. On local detection: best-effort fire-and-forget `POST /pending/:id/local-resolved`, then exits 0 with empty stdout (native dialog handles). On daemon connection refused: exits 0 with empty stdout (native dialog handles).
- **`packages/cli`**: `commander.js` setup. `watchcode start` spawns the daemon detached and idempotently merges the hook entry into `~/.claude/settings.json` (read existing, merge, write — never duplicate). Hook entry uses `matcher: ""` (matches all tools) and `timeout: 259200`. `watchcode stop` reads PID file, sends SIGTERM, waits, optional `--keep-hook`.
- **Modules built**: `Queue`, `DecisionEmitter`, `TranscriptWatcher` (interfaces from PRD §Implementation Decisions / Deep modules).

**Spike (gate for completion):** with the daemon running and the hook registered, fire a real Claude Code session that needs a Bash permission. Inject a decision via `curl -X POST 'http://127.0.0.1:9876/pending/<id>/decision' -d '{"decision":"always"}'` so the hook returns `permissionRules: ["Bash(<exact command>)"]`. Verify the next identical command in the same session is auto-approved (no dialog appears). If the grammar differs from the assumed string-form, document the actual format in `docs/protocol.md` and update the rule output to match. This empirical verification is the slice's core acceptance.

## Acceptance criteria

- [ ] `watchcode start` registers the `PermissionRequest` hook in `~/.claude/settings.json` with `matcher: ""` and `timeout: 259200`; running it twice does not duplicate the entry
- [ ] `watchcode stop` cleanly terminates the daemon and removes the PID file
- [ ] Daemon serves all four HTTP endpoints with the request/response shapes from `docs/ARCHITECTURE.md` §5
- [ ] Hook subprocess parses Claude Code's stdin JSON, dual-polls (transcript size + decision long-poll), and emits the right stdout for each outcome (approve/always/deny/local)
- [ ] Daemon-down case: hook gets connection-refused, exits 0 with empty stdout — Claude Code's native dialog still handles the request unchanged
- [ ] Local-response case: simulated transcript growth ≥100 bytes triggers `POST /pending/:id/local-resolved` and silent exit (verify daemon log shows the call)
- [ ] **Spike passes**: emitting `permissionRules: ["Bash(echo hello)"]` causes a subsequent identical `Bash(echo hello)` request to auto-approve in the same session. Document confirmed grammar (or actual grammar if different) in `docs/protocol.md`.
- [ ] Unit tests: `Queue` (idempotent double-resolve, removal-on-resolve, ordering), `DecisionEmitter` (one test per outcome verifying exact stdout bytes), settings.json merge idempotency
- [ ] Manual e2e demo: real `claude` session → tool requested → terminal dialog appears → `curl` injects approve → tool runs

## Blocked by

#2

