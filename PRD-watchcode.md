# PRD: WatchCode
**Version:** 2.0.0 | **Status:** Locked for v1 build | **Owner:** TBD
**Package:** `watchcode` (npm) | **Repo:** pnpm monorepo | **License:** MIT (open source)

> **v2.0 changelog:** Architecture rewritten after design-tree grilling. Key corrections: `PermissionRequest` hook runs in parallel with the native dialog (not as replacement), so Claude Code's behavior stays identical with or without WatchCode connected. Watch is purely additive — first responder wins, other side auto-syncs. Reference implementation that proves this pattern: [cc-remote-approval](https://github.com/Manta-Network/cc-remote-approval).

---

## 1. EXECUTIVE SUMMARY

WatchCode is an open-source CLI tool that bridges Claude Code's permission system to a Galaxy Watch (Wear OS), allowing developers to approve or reject agent actions from their wrist without being at their keyboard. It registers a `PermissionRequest` hook that runs in parallel with Claude Code's native permission dialog, forwards pending approvals over local WiFi to the watch, and lets either the PC or the watch resolve the request — first responder wins, the other side auto-syncs.

**One-line pitch:** Approve Claude Code actions from your wrist while you grab coffee — without changing how Claude Code behaves at your desk.

**Design principle:** Watch is **additive, not replacing**. With WatchCode running, the native terminal/app dialog still appears exactly as before. Without WatchCode (or with no watch paired, or daemon stopped), Claude Code behaves identically to a fresh install.

---

## 2. PROBLEM STATEMENT

Claude Code requires explicit user approval before running commands, editing files, or making network requests. Today, the developer must be physically present at their terminal or app to respond. This creates friction: agents stall whenever the developer steps away, breaking flow and reducing the value of autonomous agentic coding sessions.

**Pain points:**
- Agent blocks indefinitely when developer is away from desk
- Existing remote-approval solutions (e.g., Telegram-based cc-remote-approval) require an internet path and external accounts
- A wrist-based response is faster than pulling out a phone, especially for the common Approve case

---

## 3. OBJECTIVES & SUCCESS METRICS

| Objective | Metric | Target (v1) |
|---|---|---|
| Remote approval without PC | Approvals completed from watch | >70% of away-from-desk events |
| Zero-friction install | Time from `npm install -g watchcode` to first approval | <5 minutes |
| Battery acceptable | Watch battery delta during active session | ≤8%/hr (near-zero when WiFi sleeps) |
| Multi-session support | Concurrent sessions handled | ≥3 simultaneous |
| Open-source adoption | GitHub stars at 3 months | 500+ |
| Native-behavior preservation | Claude Code UX with WatchCode running and idle | Indistinguishable from no plugin |

---

## 4. SCOPE

### In scope (v1)
- `PermissionRequest` hook (parallel mode) for tool-permission approvals
- Galaxy Watch 6 / Wear OS app (Kotlin + Jetpack Compose)
- Local WiFi transport: persistent WebSocket from watch (foreground service) to daemon
- mDNS discovery (`_watchcode._tcp.local`) — no manual IP configuration
- Multi-watch support (broadcast all paired, first responder wins)
- Multi-session support (concurrent approvals queue on watch with session label)
- Pairing flow with 60-second window + 6-digit code + per-watch HMAC secret
- HMAC-signed WebSocket messages (replay-safe via nonces)
- CLI: `start`, `stop`, `pair`, `unpair`, `status`, `config`, `logs`, `test`
- Three buttons per card: Approve / Always / Deny — mirrors native dialog

### Out of scope (v1) → v2 candidates
- AskUserQuestion (clarifying questions with multi-select / free text) — separate watch UX, voice/keyboard input
- Preset quick replies / "deny with custom message" — depends on AskUserQuestion or PreToolUse rework
- Wildcard / prefix-based "Always" rules (`Bash(npm:*)`) — v1 uses exact-match rules only, safer
- Notification, Stop, Elicitation hooks — v1 covers PermissionRequest only
- Claude Code plugin distribution wrapper (`/plugin install watchcode`) — v1.5 once npm path is stable
- Other agents (Copilot, Codex, Gemini) — abstract adapter is a v2 architectural extension
- iOS / Apple Watch — different stack
- TLS / mTLS for WebSocket transport — HMAC is sufficient at v1's threat model
- Wear OS Tile (queue count on watch face)
- macOS code signing / Windows authenticode for the daemon binary
- Cloud relay / FCM / phone-based bridge

---

## 5. ARCHITECTURE

### System overview
```
Claude Code session(s)             Native permission dialog
        │                              ▲ user can respond here
        │  PermissionRequest hook      │
        ▼  fires (in parallel)         │
   Hook subprocess  ──HTTP──▶  Daemon ──WebSocket──▶  Galaxy Watch
   (npx watchcode hook)        (Node)                 (Wear OS app)
        │                          │                       ▲ user can respond here
        │                          │   ApprovalCard
        │  polls daemon            │
        │  + transcript size       │  approval_resolved (broadcast)
        ▼
   Decision (or silent exit
    if user responded locally)

Either side resolves first → other side auto-syncs.
```

### Component breakdown

#### A. `packages/daemon` (TypeScript / Node.js)
- Long-lived process, started by `watchcode start`
- WebSocket server on port `9876`, mDNS-advertised as `_watchcode._tcp.local`
- HTTP API (same port) for hook script communication
- Holds in-memory queue: `Map<uuid, PendingApproval>`
- Reads transcript JSONL on first hook for a session to extract `slug` (Claude's session name); caches per `session_id`
- Constructs `permissionRules` (exact-match form) when watch responds with "Always"
- Maintains paired-watch list with HMAC secrets in `~/.watchcode/config.json`
- Verifies HMAC + nonce on every inbound watch message
- Heartbeat (`daemon_status`) every 5s on the WebSocket

#### B. `packages/cli` (TypeScript)
- `commander.js`-based CLI, published as `watchcode` on npm
- `watchcode start` registers the PermissionRequest hook in `~/.claude/settings.json` and starts the daemon
- Talks to daemon via local HTTP

#### C. `packages/hook` (TypeScript) — the hook subprocess
- Entry point: `npx watchcode hook` (or compiled equivalent)
- Reads JSON from stdin (Claude Code's hook input)
- Captures transcript baseline file size
- POSTs to daemon: `POST /pending` with tool details, gets back `uuid`
- Polls in a 1-second loop:
  - Check transcript file size — if grew by ≥100 bytes, **local response detected** → exit silently with empty stdout
  - Long-polls `GET /pending/<uuid>/decision` — if returned, write decision JSON to stdout, exit 0
- Hook timeout in `settings.json`: `259200` (3 days)
- If daemon is down: connection refused → exit silently → native dialog handles unchanged

#### D. `apps/watch` (Kotlin / Wear OS)
- Single-Activity Jetpack Compose app
- Persistent foreground service (with ongoing notification per Wear OS conventions) holding a `WifiLock` and an `OkHttp` WebSocket to the daemon
- mDNS discovery via `NsdManager` on first connect / after network change
- Reconnect strategy: exponential backoff (1s → 2s → 4s → 8s → 30s cap)
- All outbound messages signed with the per-watch HMAC secret + 32-bit monotonic nonce
- Screens: `PairingScreen`, `QueueScreen`, `ApprovalCard`
- HMAC secret stored in `EncryptedSharedPreferences`

#### E. `packages/shared` (TypeScript)
- Zod schemas for all protocol messages
- Shared types used by daemon, hook, CLI
- Protocol constants (port, mDNS service name, HMAC algorithm, nonce window)

---

## 6. WEBSOCKET PROTOCOL

All messages JSON over WebSocket (`ws://watchcode.local:9876`). Watch → daemon messages carry HMAC and nonce; daemon → watch messages don't (daemon is the trust root for the watch).

### daemon → watch

**`approval_request`**
```json
{
  "type": "approval_request",
  "id": "<uuid-v4>",
  "session": {
    "id": "<session_id>",
    "slug": "inherited-napping-eagle",
    "cwd_basename": "my-api"
  },
  "tool": {
    "name": "Bash",
    "title": "Allow Claude to run \"Verify slug consistency\"?",
    "body": "grep -h '\"slug\"' /Users/khushal/.claude/...",
    "raw_input": { "command": "...", "description": "..." }
  },
  "timestamp": "<ISO-8601>"
}
```

**`approval_resolved`** — broadcast to all watches when any side resolves
```json
{
  "type": "approval_resolved",
  "request_id": "<uuid-v4>",
  "resolved_by": "watch | local",
  "decision": "approve | always | deny | (empty if local)"
}
```

**`daemon_status`** — heartbeat every 5s
```json
{
  "type": "daemon_status",
  "active_sessions": 2,
  "pending_count": 1,
  "version": "1.0.0"
}
```

### watch → daemon (HMAC-signed)

**`approval_response`**
```json
{
  "type": "approval_response",
  "request_id": "<uuid-v4>",
  "decision": "approve | always | deny",
  "nonce": 12847,
  "hmac": "<hex sha256(secret, body|nonce)>"
}
```

### Hook stdout contract (decision → Claude Code)

Approve:
```json
{ "hookSpecificOutput": { "hookEventName": "PermissionRequest", "decision": { "behavior": "allow" } } }
```

Always (exact-match rule):
```json
{ "hookSpecificOutput": { "hookEventName": "PermissionRequest", "decision": { "behavior": "allow", "permissionRules": ["Bash(<exact command>)"] } } }
```

Deny:
```json
{ "hookSpecificOutput": { "hookEventName": "PermissionRequest", "decision": { "behavior": "deny" } } }
```

Local response detected (user responded at native dialog): **exit 0 with empty stdout** — no decision returned, native dialog's response is authoritative.

---

## 7. DATA MODEL

### `~/.watchcode/config.json`
```json
{
  "daemon": {
    "port": 9876,
    "mdns_name": "watchcode"
  },
  "watches": [
    {
      "id": "<uuid-v4>",
      "name": "Galaxy Watch 6",
      "secret": "<base64 32-byte HMAC key>",
      "paired_at": "<ISO-8601>",
      "last_seen": "<ISO-8601>",
      "last_nonce": 12847
    }
  ]
}
```

No stored IP — re-resolved via mDNS each connect, robust to DHCP changes.

### Project-level optional override
`<project_root>/.watchcode.json`:
```json
{ "name": "Customer API" }
```
If present, replaces the slug as the session label on the watch.

### Hook registration in `~/.claude/settings.json` (written by `watchcode start`)
```json
{
  "hooks": {
    "PermissionRequest": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "npx watchcode hook",
            "timeout": 259200
          }
        ]
      }
    ]
  }
}
```

Empty matcher = matches all tools. Timeout = 3 days (matches cc-remote-approval's proven configuration).

---

## 8. CLI COMMAND SURFACE

| Command | Description |
|---|---|
| `watchcode start` | Start daemon, register `PermissionRequest` hook globally |
| `watchcode stop` | Graceful shutdown; optionally `--keep-hook` to leave hook registered |
| `watchcode pair` | Open 60s pairing window, print 6-digit code, advertise mDNS, wait for watch |
| `watchcode unpair <name>` | Remove watch from config |
| `watchcode status` | Show daemon state, paired watches online/offline, pending queue, active sessions |
| `watchcode config` | View / interactively edit `~/.watchcode/config.json` |
| `watchcode logs [--follow]` | Tail daemon log file |
| `watchcode test` | Send a fake approval to all paired watches |
| `watchcode hook` | Internal — the per-permission subprocess (not user-invoked) |

---

## 9. PAIRING FLOW

```
1. User runs: watchcode pair
2. Daemon advertises _watchcode._tcp.local via mDNS
3. Daemon prints 6-digit code: "Pairing code: 482-159  (60s remaining)"
4. User opens watch app
5. Watch app discovers daemon via NsdManager → "Found WatchCode on <hostname>"
6. Watch prompts: "Enter pairing code"
7. User enters 482-159 on watch
8. Watch POSTs { device_name, pairing_code } to daemon
9. Daemon validates code → generates 32-byte secret → returns { watch_id, secret }
10. Watch stores secret in EncryptedSharedPreferences → "Paired ✓"
11. Daemon prints: "✓ Galaxy Watch 6 paired"
```

If 60 seconds elapse without successful pairing, the daemon closes the pairing window and rejects all subsequent attempts until `watchcode pair` is invoked again.

**Unpairing:** `watchcode unpair "Galaxy Watch 6"` removes entry from config and revokes the secret. The watch app shows "Disconnected — re-pair on PC" on the next reconnect attempt.

---

## 10. WATCH APP — SCREEN FLOWS

### Connection states
```
App opened
  ├─ Searching for daemon (mDNS scan)
  ├─ Found, not paired → Pairing screen (enter code)
  ├─ Found, paired → Queue screen
  └─ Not found → "Start watchcode on your PC" (with hostname hint if any)
```

### Queue screen
- `ScalingLazyColumn` of `ApprovalCard` components
- Header: number of active sessions (from `daemon_status`)
- Empty state: "No pending approvals — chill."

### Approval card
```
┌──────────────────────────────────┐
│ inherited-napping-eagle          │ ← slug (heading, bold)
│ my-api                           │ ← cwd basename pill (small, muted)
│ ──────────────────────────────── │
│ Allow Claude to run "Verify slug │ ← native-style title
│ consistency"?                    │
│                                  │
│ grep -h '"slug"' /Users/...      │ ← tool body, truncated ~300 chars
│                                  │
│  [ ✕ Deny ] [ ⟳ Always ] [ ✓ ]   │ ← three buttons, fixed-width
└──────────────────────────────────┘
```

Title construction per tool:
- **Bash:** `Allow Claude to run "{description || command-prefix}"?`
- **Edit:** `Do you want to make this edit to {basename(file_path)}?`
- **Write:** `Do you want to create {basename(file_path)}?`
- **WebFetch:** `Allow Claude to fetch {url-host}?`
- **Other:** `Allow Claude to use {tool_name}?`

On `approval_resolved` received, card is removed with a subtle haptic.

---

## 11. USER STORIES

### Epic 1 — Installation & setup
**US-01:** As a developer I run `npm install -g watchcode && watchcode start && watchcode pair` and complete first-watch pairing in under 5 minutes total.

**US-02:** As a developer I pair my Galaxy Watch without using my phone — discovery is via mDNS, confirmation via 6-digit code.

### Epic 2 — Approval flow
**US-03:** As a developer away from my desk, I receive a haptic notification on watch within 3 seconds of Claude Code requesting permission.

**US-04:** As a developer I see the session slug, project name, tool, and exact command/path on each card — enough to make an informed decision without context-switching.

**US-05:** As a developer I tap Approve / Always / Deny in one tap; Claude Code unblocks within 1 second.

**US-06:** As a developer I respond at my PC normally when I'm at the desk; the watch card disappears within 1 second when the local response is detected.

### Epic 3 — Resilience
**US-07:** As a developer my agent never silently auto-approves on timeout — if WatchCode (or just the daemon, or just the watch) fails for any reason, the native dialog stays as the source of truth.

**US-08:** As a developer if my watch disconnects mid-session, pending approvals remain in the daemon queue and re-deliver on reconnect.

### Epic 4 — Multi-session & multi-watch
**US-09:** As a developer running 3 sessions concurrently, all 3 pending approvals appear in my watch queue with distinguishing session labels.

**US-10:** As a developer with two watches paired, both receive every approval request; whichever responds first wins, and the other watch's card auto-dismisses.

---

## 12. TECH STACK

### PC side
| Package | Purpose |
|---|---|
| `ws` | WebSocket server |
| `bonjour-service` | mDNS advertisement (`mdns` is unmaintained on macOS) |
| `commander` | CLI framework |
| `uuid` | UUID v4 |
| `tsx` | TypeScript execution (no compile step for dev) |
| `zod` | Config + protocol message validation |

### Watch side
| Library | Purpose |
|---|---|
| Jetpack Compose for Wear OS | UI |
| `OkHttp` | WebSocket client |
| `NsdManager` | mDNS discovery |
| `EncryptedSharedPreferences` | Per-watch HMAC secret storage |
| `ViewModel` + `StateFlow` | State management |
| Foreground Service + WifiLock | Persistent connection |

### Tooling
| Tool | Purpose |
|---|---|
| `pnpm` workspaces | Monorepo |
| `tsconfig` (shared) | TS config |
| `Gradle` (Kotlin) | Wear OS build |
| `eslint` + `prettier` | Code quality |

---

## 13. REPO STRUCTURE

```
watchcode/
├── packages/
│   ├── shared/          # Zod schemas, protocol constants, shared types
│   ├── daemon/          # WS server, HTTP API, queue, mDNS, HMAC, transcript reader
│   ├── hook/            # PermissionRequest hook subprocess (npx watchcode hook)
│   └── cli/             # commander CLI (watchcode start/stop/pair/...)
├── apps/
│   └── watch/           # Kotlin Wear OS app
│       └── app/src/main/java/com/watchcode/{service,ui,viewmodel,net,security}/
├── docs/
│   ├── README.md
│   ├── CONTRIBUTING.md
│   ├── protocol.md
│   ├── threat-model.md
│   └── watch-install.md  # APK sideload guide
├── package.json         # pnpm workspace root
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

---

## 14. IMPLEMENTATION PLAN

### Phase 1 — Daemon + hook foundation (Week 1–2)
- [ ] Scaffold pnpm monorepo, shared tsconfig, eslint
- [ ] `packages/shared`: Zod schemas, protocol constants
- [ ] `packages/daemon`: WS server, HTTP API, in-memory queue
- [ ] `packages/daemon`: transcript JSONL reader (slug extraction, baseline size capture)
- [ ] `packages/daemon`: mDNS advertisement via `bonjour-service`
- [ ] `packages/daemon`: heartbeat (`daemon_status`) every 5s
- [ ] `packages/hook`: stdin parser, baseline-size capture, daemon POST + long-poll, transcript size watcher
- [ ] `packages/cli`: `watchcode start` (registers hook in `~/.claude/settings.json`, starts daemon), `watchcode stop`
- [ ] Manual test: hook fires → enqueues → mock approval injected via HTTP → hook returns decision

### Phase 2 — Watch app core (Week 3–4)
- [ ] Scaffold Wear OS project with Compose, OkHttp, NsdManager
- [ ] Foreground service holding WifiLock + WebSocket
- [ ] mDNS discovery + reconnect with exponential backoff
- [ ] HMAC signing helper with monotonic nonce
- [ ] `ApprovalViewModel` with `StateFlow<List<ApprovalRequest>>`
- [ ] `QueueScreen` (`ScalingLazyColumn` of cards)
- [ ] `ApprovalCard` (slug, cwd pill, title, body, three buttons)
- [ ] Handle `approval_resolved` (remove card + haptic)

### Phase 3 — Pairing + security (Week 5)
- [ ] `watchcode pair` opens 60s window, generates code, displays in terminal
- [ ] Daemon HTTP endpoint for pairing POST (validates code, generates secret)
- [ ] Watch pairing screen (entered code, POST, store secret in EncryptedSharedPreferences)
- [ ] HMAC verification on daemon side (with nonce replay protection — `last_nonce` per watch)
- [ ] `watchcode unpair`
- [ ] `watchcode test` (fake approval to all watches)

### Phase 4 — Polish + docs (Week 6)
- [ ] `watchcode status`: sessions, watches online/offline, queue
- [ ] `watchcode config`: view + interactive edit (Zod-validated)
- [ ] `watchcode logs [--follow]`: tail daemon log file
- [ ] Per-tool title construction (Bash/Edit/Write/WebFetch/other)
- [ ] Per-tool exact-match rule construction for "Always"
- [ ] `.watchcode.json` project-level name override
- [ ] Edge cases: daemon down, watch offline, malformed messages, pairing-code timeout, HMAC mismatch
- [ ] README + threat-model.md + watch-install.md

### Phase 5 — Release (Week 7)
- [ ] `npm publish watchcode`
- [ ] Watch APK build + GitHub release attachment
- [ ] `watchcode pair` prints APK download URL
- [ ] GitHub Actions CI: Node tests, Android build check
- [ ] Smoke test on clean machine: `npm install -g watchcode` → `start` → `pair` → first approval, end-to-end

---

## 15. NON-FUNCTIONAL REQUIREMENTS

| Category | Requirement |
|---|---|
| Latency | Approval notification on watch within 3s of hook firing |
| Battery (active) | ≤8%/hour during active sessions on Galaxy Watch 6 |
| Battery (idle) | Near-zero when WiFi sleeps; recovers within seconds of reconnect |
| Reliability | Daemon handles ≥10 concurrent sessions without queue corruption |
| Security | All watch → daemon messages HMAC-signed with replay-protection nonces; pairing requires explicit 60s window + 6-digit code |
| Cross-platform | Daemon runs on macOS, Linux, Windows (Node.js ≥20) |
| Watch compat | Galaxy Watch 6 (Wear OS 4); other Wear OS 4+ devices best-effort |
| Behavior preservation | Claude Code's native UX is byte-identical to no-WatchCode install when daemon is stopped or no watch is paired |
| Failure mode | Any failure (daemon crash, watch offline, HMAC mismatch, network partition) falls back to native dialog — never silently allows or denies |
| Config safety | Zod validates config on every read; bad config prints helpful error |

---

## 16. OPEN QUESTIONS (v2 scope)

| Question | Likely answer |
|---|---|
| AskUserQuestion (clarifying questions) | Yes — separate card type with option buttons + voice/keyboard for free text |
| Preset quick replies / "deny with reason" | Yes — only feasible after AskUserQuestion lands or a `PreToolUse`-based rework |
| Wildcard "Always" rules (`Bash(npm:*)`) | Yes — heuristic prefix extraction with conservative defaults |
| Plugin distribution wrapper | Yes — `/plugin install watchcode` thin wrapper around npm |
| Other agents (Copilot, Codex, Gemini) | Yes — abstract hook adapter interface |
| Wear OS Tile (queue count on watch face) | Yes — Tiles API |
| Web dashboard for session monitoring | Maybe — low priority |
| Apple Watch / watchOS | Out of scope — different stack |
| TLS / mTLS over local WiFi | If users request it for sensitive office networks |

---

## 17. DEFINITION OF DONE

A feature is **done** when:
- Code reviewed and merged to `main`
- Unit tests pass (daemon queue, HMAC verification, message parsing, config validation, transcript slug extraction)
- Integration test: hook fires → mock watch receives → mock watch responds → hook returns decision → Claude Code unblocks
- Local-response test: hook fires → simulate transcript growth → hook exits silently with empty stdout
- No TypeScript errors (`tsc --noEmit`); no Kotlin warnings
- User-facing changes documented in `docs/`

A **release** is done when:
- All Phase 1–4 items checked
- `npm install -g watchcode && watchcode start && watchcode pair` plus first approval works end-to-end on a clean machine in <5 minutes
- APK installable via the URL printed by `watchcode pair`
- README covers install / pair / daily use in <5 minutes of reading
- Threat model in `docs/threat-model.md` honestly documents what HMAC + pairing-window protects and what it doesn't (e.g., no defense against a compromised PC)
