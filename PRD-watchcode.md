# PRD: WatchCode
**Version:** 1.0.0 | **Status:** Draft | **Owner:** TBD
**Package:** `watchcode` (npm) | **Repo:** pnpm monorepo | **License:** MIT (open source)

---

## 1. EXECUTIVE SUMMARY

WatchCode is an open-source CLI tool that bridges Claude Code's permission system to a Galaxy Watch (Wear OS), allowing developers to approve or reject agent actions from their wrist without being at their keyboard. It hooks into Claude Code's `PermissionRequest` event, routes pending approvals over local WiFi to a Wear OS watch app, and writes the decision back to Claude Code's stdin — all with zero cloud dependency, no phone required, and near-zero battery impact at rest.

**One-line pitch:** Approve Claude Code actions from your wrist while you grab coffee.

---

## 2. PROBLEM STATEMENT

Claude Code and similar coding agents require explicit user approval before running commands, editing files, or making network requests. Today, the developer must be physically present at their terminal to respond. This creates friction: agents stall whenever the developer steps away, breaking flow and reducing the value of autonomous agentic coding sessions.

**Pain points:**
- Agent blocks and waits indefinitely when developer is away from desk
- No way to monitor or respond to multiple simultaneous sessions remotely
- Existing solutions require a phone relay (complex) or always-on cloud (privacy risk)

---

## 3. OBJECTIVES & SUCCESS METRICS

| Objective | Metric | Target (v1) |
|---|---|---|
| Remote approval without PC | Approvals completed from watch | >80% of sessions |
| Zero friction install | Time from `npx watchcode` to first approval | <5 minutes |
| Battery neutral | Watch battery delta vs baseline | <2% per hour |
| Multi-session support | Concurrent sessions handled | ≥3 simultaneous |
| Open source adoption | GitHub stars at 3 months | 500+ |

---

## 4. SCOPE

### In scope (v1)
- Claude Code integration via `PermissionRequest` hook
- Galaxy Watch 6 / Wear OS app (Kotlin + Jetpack Compose)
- Local WiFi transport: UDP wake + on-demand WebSocket
- mDNS discovery (`watchcode.local`) — no IP configuration
- Multi-watch support (broadcast all, first responder wins)
- CLI: `start`, `stop`, `pair`, `unpair`, `status`, `config`, `logs`, `test`
- Approve / Reject / 3 preset quick replies per approval card
- Pending queue on watch (scrollable, tagged by session name)

### Out of scope (v1)
- Support for GitHub Copilot, Codex, Gemini (architecture supports it — v2)
- Phone relay / Bluetooth direct PC-to-watch
- Cloud relay / FCM push notifications
- iOS / Apple Watch support
- Wear OS Tiles (watch face queue count) — v2 roadmap

---

## 5. ARCHITECTURE

### System overview
```
Claude Code session(s)
        │  PermissionRequest hook (stdin/stdout)
        ▼
watchcode daemon  ──UDP broadcast──▶  Galaxy Watch (wakes)
  (Node.js/TS)    ◀──WebSocket──────▶  Watch app (Kotlin)
        │
  ~/.watchcode/config.json
```

### Component breakdown

#### A. packages/daemon (TypeScript)
- Registers as `PermissionRequest` hook in `~/.claude/settings.json` (global) + `.claude/settings.json` (project override)
- Auto-starts when first hook fires (checks if already running via PID file)
- Holds a `Promise` per approval request — resolves when watch or PC responds
- Maintains in-memory queue: `Map<uuid, PendingApproval>`
- Runs WebSocket server on port `9876`
- Advertises via mDNS as `_watchcode._tcp.local`
- Sends UDP broadcast on port `9877` when new approval arrives
- Writes `{ "behavior": "allow" }` or `{ "behavior": "deny", "message": "<preset>" }` to stdout

#### B. packages/cli (TypeScript)
- Built with `commander.js`, published as `watchcode` on npm
- Entry point: `npx watchcode <command>`
- Communicates with daemon via local HTTP on port `9876`

#### C. apps/watch (Kotlin / Wear OS)
- Single `Activity` with Jetpack Compose for Wear OS navigation
- `WakefulBroadcastReceiver` listens for UDP broadcast — zero battery at rest
- On wake: opens `OkHttp` WebSocket to `ws://watchcode.local:9876`
- Disconnects after 30s idle
- Reconnect strategy: exponential backoff (1s → 2s → 4s → 8s → 30s cap)
- State: `ApprovalViewModel` + `StateFlow<List<ApprovalRequest>>`
- Screens: `QueueScreen` (ScalingLazyColumn), `ApprovalCard`, `PresetSheet`

#### D. packages/shared (TypeScript)
- Zod schemas for all protocol messages
- Shared TypeScript types used by daemon and CLI
- Protocol constants (ports, mDNS name, defaults)

---

## 6. WEBSOCKET PROTOCOL

All messages are JSON over WebSocket (`ws://watchcode.local:9876`).

### daemon → watch

**`approval_request`** — new item requiring decision
```json
{
  "type": "approval_request",
  "id": "<uuid-v4>",
  "session": { "id": "<uuid>", "name": "my-api project" },
  "action": { "tool": "Bash", "prompt": "Run: npm install" },
  "presets": ["skip this step", "try a different approach", "do it manually"],
  "timestamp": "<ISO-8601>"
}
```

**`approval_resolved`** — broadcast to all clients when any client resolves
```json
{
  "type": "approval_resolved",
  "requestId": "<uuid-v4>",
  "decision": "approve | deny | preset",
  "resolvedBy": "pc | watch"
}
```

**`daemon_status`** — heartbeat every 5s
```json
{
  "type": "daemon_status",
  "activeSessions": 2,
  "pendingCount": 1,
  "daemonVersion": "1.0.0"
}
```

### watch → daemon

**`approval_response`** — user decision from watch
```json
{
  "type": "approval_response",
  "requestId": "<uuid-v4>",
  "decision": "approve | deny | preset",
  "presetValue": "skip this step"
}
```

### stdout contract (daemon → Claude Code)
```json
approve  →  { "behavior": "allow" }
deny     →  { "behavior": "deny" }
preset   →  { "behavior": "deny", "message": "<presetValue>" }
```

---

## 7. DATA MODEL

### ~/.watchcode/config.json
```json
{
  "daemon": {
    "port": 9876,
    "mdnsName": "watchcode",
    "udpBroadcastPort": 9877
  },
  "watches": [
    {
      "id": "<uuid-v4>",
      "name": "Galaxy Watch 6",
      "ip": "192.168.1.42",
      "pairedAt": "<ISO-8601>",
      "lastSeen": "<ISO-8601>",
      "active": true
    }
  ],
  "presets": [
    "skip this step",
    "try a different approach",
    "do it manually"
  ]
}
```

### Claude Code hook registration (~/.claude/settings.json)
```json
{
  "hooks": {
    "PermissionRequest": [
      { "command": "npx watchcode hook" }
    ]
  }
}
```

---

## 8. CLI COMMAND SURFACE

| Command | Description |
|---|---|
| `watchcode start` | Start daemon, register `PermissionRequest` hook globally |
| `watchcode stop` | Graceful shutdown, deregister hook |
| `watchcode pair` | Advertise via mDNS, wait for watch to confirm, save to config |
| `watchcode unpair <name>` | Remove watch from config by device name |
| `watchcode status` | Show active sessions, paired watches online/offline, pending queue |
| `watchcode config` | View / interactively edit `~/.watchcode/config.json` |
| `watchcode logs [--follow]` | Tail daemon logs |
| `watchcode test` | Send a fake approval request to all paired watches |

---

## 9. PAIRING FLOW

```
1. User runs: npx watchcode pair
2. Daemon starts, advertises _watchcode._tcp.local via mDNS
3. Watch app (open) discovers service via NsdManager
4. Watch shows: "Found WatchCode on <hostname> — connect?" + Confirm button
5. User taps Confirm → watch POSTs { deviceName, ip } to daemon
6. Daemon saves watch to config, sends test UDP ping
7. Watch receives ping → haptic buzz → "Paired successfully"
8. Terminal prints: "✓ Galaxy Watch 6 paired"
```

**Unpairing:** `watchcode unpair "Galaxy Watch 6"` removes entry from config. Watch app shows "Disconnected" on next connection attempt.

---

## 10. WATCH APP — SCREEN FLOWS

### Connection states
```
App opened
  └─ Searching for daemon (mDNS scan)
       ├─ Found → connect WebSocket → show QueueScreen
       └─ Not found → show "Start watchcode on your PC" screen
```

### Queue screen
- `ScalingLazyColumn` of `ApprovalCard` components
- Each card shows: session name (pill), tool name, prompt text (truncated to 2 lines)
- Empty state: "No pending approvals"
- `daemon_status` heartbeat updates session count in header

### Approval card interaction
```
Tap card → expand
  ├─ [Approve] button → sends approval_response { decision: "approve" }
  ├─ [Reject] button  → sends approval_response { decision: "deny" }
  └─ [...]  button    → opens PresetSheet
       ├─ "skip this step"          → { decision: "preset", presetValue: "..." }
       ├─ "try a different approach" → { decision: "preset", presetValue: "..." }
       └─ "do it manually"          → { decision: "preset", presetValue: "..." }

On approval_resolved received → remove card from queue + haptic
```

---

## 11. USER STORIES

### Epic 1 — Installation & Setup

**US-01**
> As a developer, I want to install WatchCode with a single `npx` command so that I don't need a complex setup process.

*Acceptance criteria:*
- Given I have Node.js installed, when I run `npx watchcode start`, then the daemon starts and confirms it's listening
- Given the daemon is running, when I run `watchcode pair`, then it guides me through pairing with no manual IP entry

**US-02**
> As a developer, I want to pair my Galaxy Watch without using my phone so that I have one less dependency.

*Acceptance criteria:*
- Given watch and PC are on the same WiFi, when I open the watch app during `watchcode pair`, then the watch auto-discovers the daemon via mDNS
- Given discovery succeeds, when I tap Confirm on the watch, then pairing completes in under 10 seconds

### Epic 2 — Approval flow

**US-03**
> As a developer away from my desk, I want to receive a haptic notification when Claude Code needs approval so that I know to respond.

*Acceptance criteria:*
- Given the watch is idle (screen off), when Claude Code requests permission, then the watch buzzes and wakes within 3 seconds
- Given the notification arrives, when I raise my wrist, then the approval card is immediately visible

**US-04**
> As a developer, I want to see which session and what action is being requested so that I can make an informed decision.

*Acceptance criteria:*
- Given an approval card, it must show: session name, tool name, and the full prompt (scrollable if long)
- Given multiple sessions are active, each card must be tagged with its session name

**US-05**
> As a developer, I want to approve or reject actions with one tap so that it's faster than walking to my PC.

*Acceptance criteria:*
- Given an approval card, Approve and Reject are reachable in one tap
- Given I tap Approve, Claude Code unblocks and proceeds within 1 second
- Given I tap Reject, Claude Code blocks the action within 1 second

**US-06**
> As a developer, I want to send a quick preset reply so that I can give Claude Code direction without typing.

*Acceptance criteria:*
- Given an approval card, a third option opens a preset sheet with 3 options
- Given I select a preset, Claude Code receives `{ "behavior": "deny", "message": "<preset>" }`

**US-07**
> As a developer, I want approvals handled at my PC to automatically disappear from my watch so that the queue stays clean.

*Acceptance criteria:*
- Given I respond to an approval on my PC terminal, the corresponding watch card is removed within 1 second
- Given a card is removed, a subtle haptic confirms the resolution

### Epic 3 — Resilience

**US-08**
> As a developer, I want the agent to keep waiting if I don't respond immediately so that I never lose work.

*Acceptance criteria:*
- Given an approval is pending and I don't respond, Claude Code waits indefinitely (no timeout)
- Given the watch disconnects mid-session, pending approvals remain in daemon queue and re-deliver on reconnect

**US-09**
> As a developer, I want the watch to reconnect automatically after a network drop so that I don't have to manually restart anything.

*Acceptance criteria:*
- Given the WebSocket drops, the watch retries with exponential backoff (1s→2s→4s→8s→30s)
- Given the watch reconnects, it receives any new approvals that arrived while disconnected

### Epic 4 — Multi-session & multi-watch

**US-10**
> As a developer running multiple Claude Code sessions, I want to see all pending approvals in one queue so that I can triage from my watch.

*Acceptance criteria:*
- Given 3 sessions each request approval simultaneously, all 3 appear in the watch queue
- Given I respond to one, the others remain unaffected

**US-11**
> As a developer sharing a workstation with a teammate, I want both our watches to receive approvals so that whoever is available can respond.

*Acceptance criteria:*
- Given 2 watches are paired, both receive every `approval_request` broadcast
- Given watch A responds first, watch B's card is removed via `approval_resolved`

---

## 12. TECH STACK

### PC side
| Package | Purpose |
|---|---|
| `ws` | WebSocket server |
| `mdns` | mDNS advertisement (`_watchcode._tcp.local`) |
| `commander` | CLI framework |
| `uuid` | UUID v4 approval IDs |
| `tsx` | TypeScript execution (no compile step for dev) |
| `zod` | Config + protocol message validation |

### Watch side
| Library | Purpose |
|---|---|
| Jetpack Compose for Wear OS | UI layer |
| `OkHttp` | WebSocket client |
| `NsdManager` | mDNS service discovery |
| `DatagramSocket` | UDP broadcast receiver |
| `ViewModel` + `StateFlow` | State management |

### Tooling
| Tool | Purpose |
|---|---|
| `pnpm` workspaces | Monorepo management |
| `tsconfig` (shared) | TypeScript config |
| `Gradle` | Android/Wear OS build |
| `eslint` + `prettier` | Code quality |

---

## 13. REPO STRUCTURE

```
watchcode/
├── packages/
│   ├── shared/          # TS types, Zod schemas, protocol constants
│   ├── daemon/          # WS server, hook handler, queue, mDNS, UDP
│   └── cli/             # commander.js CLI, npx entry point
├── apps/
│   └── watch/           # Kotlin Wear OS app (Gradle)
│       ├── app/src/main/
│       │   ├── java/com/watchcode/
│       │   │   ├── receiver/    # WakefulBroadcastReceiver
│       │   │   ├── service/     # WebSocketService
│       │   │   ├── viewmodel/   # ApprovalViewModel
│       │   │   └── ui/          # QueueScreen, ApprovalCard, PresetSheet
│       │   └── AndroidManifest.xml
│       └── build.gradle
├── docs/
│   ├── README.md
│   ├── CONTRIBUTING.md
│   ├── protocol.md      # This protocol spec
│   └── watch-install.md # Sideload guide for watch app
├── package.json         # pnpm workspace root
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

---

## 14. IMPLEMENTATION PLAN

### Phase 1 — Core daemon + hook (Week 1–2)
- [ ] Scaffold monorepo (pnpm workspaces, tsconfig, eslint)
- [ ] `packages/shared`: Zod schemas for all 4 message types + config
- [ ] `packages/daemon`: WS server, in-memory queue, UUID generation
- [ ] `packages/daemon`: `PermissionRequest` hook script (stdin → stdout)
- [ ] `packages/daemon`: Auto-start logic (PID file check, spawn if not running)
- [ ] `packages/daemon`: mDNS advertisement via `mdns`
- [ ] `packages/daemon`: UDP broadcast on port 9877
- [ ] `packages/daemon`: Heartbeat (`daemon_status`) every 5s
- [ ] `packages/cli`: `watchcode start` / `watchcode stop`
- [ ] Manual test: hook fires → daemon enqueues → stdout written

### Phase 2 — Watch app core (Week 3–4)
- [ ] Scaffold Wear OS project (Compose, OkHttp, NsdManager)
- [ ] `WakefulBroadcastReceiver`: UDP listener, wake on packet
- [ ] `WebSocketService`: connect to `ws://watchcode.local:9876`, expBackoff reconnect, 30s idle disconnect
- [ ] `ApprovalViewModel`: `StateFlow<List<ApprovalRequest>>`, add/remove by UUID
- [ ] `QueueScreen`: `ScalingLazyColumn` of cards
- [ ] `ApprovalCard`: session pill, tool name, prompt, Approve/Reject/Preset buttons
- [ ] `PresetSheet`: 3 chip options, sends `approval_response`
- [ ] Handle `approval_resolved`: remove card + haptic

### Phase 3 — Pairing flow (Week 5)
- [ ] `watchcode pair` CLI command: mDNS advertise, HTTP endpoint for confirm POST
- [ ] Watch app pairing screen: NsdManager discovery, confirm button, POST to daemon
- [ ] Config read/write: save/load `~/.watchcode/config.json` with Zod validation
- [ ] `watchcode unpair <name>` command
- [ ] `watchcode test` command: fake approval_request to all paired watches

### Phase 4 — Polish + remaining CLI (Week 6)
- [ ] `watchcode status`: sessions, watches online/offline, queue count
- [ ] `watchcode config`: view + interactive edit
- [ ] `watchcode logs [--follow]`: tail daemon log file
- [ ] Global hook registration in `~/.claude/settings.json` via `watchcode start`
- [ ] Project-level hook in `.claude/settings.json` (override)
- [ ] Error handling: daemon not running, watch offline, malformed messages
- [ ] README + docs/watch-install.md (sideload guide)

### Phase 5 — Release (Week 7)
- [ ] npm publish `watchcode` package
- [ ] APK build + GitHub release for watch app
- [ ] `watchcode pair` prints watch app download link
- [ ] GitHub Actions: CI for daemon/CLI tests, Android build check

---

## 15. NON-FUNCTIONAL REQUIREMENTS

| Category | Requirement |
|---|---|
| Latency | Approval notification on watch within 3s of hook firing |
| Battery | Watch battery drain <2% per hour while idle |
| Reliability | Daemon handles ≥10 concurrent sessions without queue corruption |
| Security | No data leaves local network; no auth tokens stored in config |
| Cross-platform | Daemon runs on macOS, Linux, Windows (Node.js ≥18) |
| Watch compat | Galaxy Watch 6 (Wear OS 4+); other Wear OS devices best-effort |
| Offline graceful | If watch offline, approval waits on PC terminal — no error thrown |
| Config safety | Zod validates config on every read; bad config prints helpful error |

---

## 16. OPEN QUESTIONS (v2 scope)

| Question | Likely answer |
|---|---|
| Support other agents (Copilot, Codex)? | Yes — abstract hook interface in daemon, agent-specific adapters |
| Wear OS Tile showing queue count on watch face? | Yes — v2, uses Tiles API |
| Custom presets per project? | Yes — project-level config override |
| Web dashboard for session monitoring? | Maybe — low priority |
| Apple Watch / watchOS support? | Out of scope — different stack entirely |

---

## 17. DEFINITION OF DONE

A feature is **done** when:
- Code reviewed and merged to `main`
- Unit tests pass (daemon queue logic, message parsing, config validation)
- Manual test: approval fires on Claude Code → appears on watch → response unblocks agent
- No TypeScript errors (`tsc --noEmit`)
- Documented in relevant `docs/` file if user-facing

A **release** is done when:
- All Phase 1–4 items checked
- `npx watchcode start` + `watchcode pair` + first approval works end-to-end on a clean machine
- APK installable via `watchcode pair` link
- README covers install, pair, and daily use in under 5 minutes of reading
