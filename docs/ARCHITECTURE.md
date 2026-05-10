# WatchCode — Architecture & Implementation Blueprint

**Companion to:** [PRD-watchcode.md](../PRD-watchcode.md) v2.0 (locked).
**Audience:** developers about to write code. Decisions already settled in the PRD are referenced, not re-argued.
**Scope:** file-level design for the v1 build (Phases 1–5 of PRD §14).

---

## 1. Repository layout

Every file in the v1 tree, one-line purpose. `*` = added in a later phase but its location is reserved now.

```
watchcode/
├── package.json                         # pnpm workspace root, scripts: build/test/lint, no runtime deps
├── pnpm-workspace.yaml                  # globs: packages/*, apps/* (apps/watch ignored by pnpm — Gradle owns it)
├── tsconfig.base.json                   # strict, ES2022, NodeNext, composite for project refs
├── .eslintrc.cjs                        # shared lint config
├── .prettierrc                          # formatting
├── .gitignore                           # node_modules, dist, .gradle, *.apk, *.keystore
├── .npmrc                               # link-workspace-packages=true, save-exact=true
├── LICENSE                              # MIT
├── README.md                            # install / pair / daily use, <5min read
├── PRD-watchcode.md                     # source of truth (PRD v2.0)
│
├── docs/
│   ├── ARCHITECTURE.md                  # this file
│   ├── CONTRIBUTING.md                  # dev setup, PR conventions
│   ├── protocol.md                      # frozen wire protocol reference (mirrors §3 of this doc)
│   ├── threat-model.md                  # what HMAC + pairing protect; what they don't
│   └── watch-install.md                 # APK sideload guide (ADB + Wear OS dev mode)
│
├── packages/
│   │
│   ├── shared/                          # pure types/schemas, zero runtime side effects
│   │   ├── package.json                 # name: @watchcode/shared, main: dist/index.js
│   │   ├── tsconfig.json                # extends base, composite: true
│   │   ├── src/
│   │   │   ├── index.ts                 # barrel: re-exports protocol, config, hookIo, constants
│   │   │   ├── constants.ts             # PORT=9876, MDNS_TYPE, HMAC_ALG, NONCE_BYTES, POLL_INTERVAL_MS, etc.
│   │   │   ├── protocol.ts              # Zod schemas: ApprovalRequest, ApprovalResolved, DaemonStatus, ApprovalResponse, PairingHello
│   │   │   ├── config.ts                # Zod: WatchcodeConfig, PairedWatch; load/save helpers
│   │   │   ├── hookIo.ts                # Zod: HookInput (from CC), HookOutput (decision JSON for stdout)
│   │   │   └── slug.ts                  # extractSlugFromTranscript() — JSONL line scanner
│   │   └── test/
│   │       ├── protocol.test.ts         # round-trip parse for every message variant
│   │       ├── config.test.ts           # rejects unknown keys, accepts minimal, migrates absent last_nonce
│   │       └── slug.test.ts             # finds slug; iterates past entries that lack it
│   │
│   ├── daemon/                          # the long-lived process
│   │   ├── package.json                 # name: @watchcode/daemon, bin: none (called by CLI)
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts                 # exports startDaemon(opts) — used by CLI, not a CLI itself
│   │   │   ├── server.ts                # http+ws on PORT 9876; routes table; graceful shutdown
│   │   │   ├── http/
│   │   │   │   ├── routes.ts            # POST /pending, GET /pending/:id/decision, POST /pair, GET /status, POST /test, POST /shutdown
│   │   │   │   ├── pending.ts           # handler: enqueue + broadcast + long-poll resolution
│   │   │   │   ├── pair.ts              # handler: validates 6-digit code, mints secret, persists watch
│   │   │   │   └── status.ts            # handler: snapshot of queue + watches + sessions
│   │   │   ├── ws/
│   │   │   │   ├── server.ts            # ws.Server attach to http; per-conn state; auth on first signed msg
│   │   │   │   ├── connection.ts        # per-watch lifecycle: identify → verify HMAC → mark online
│   │   │   │   ├── broadcast.ts         # send to all online watches; track per-conn delivery
│   │   │   │   └── heartbeat.ts         # daemon_status every 5s; ping/pong watchdog
│   │   │   ├── queue.ts                 # in-memory Map<uuid, PendingApproval>; resolve() is idempotent
│   │   │   ├── sessions.ts              # Map<session_id, {slug, transcript_path, baseline_size}>; lazy slug fetch
│   │   │   ├── transcript.ts            # readJsonl(), findSlug(): iterates entries skipping ones without slug
│   │   │   ├── hmac.ts                  # signCanonical(secret, body, nonce); verifyAndAdvanceNonce(watch, msg)
│   │   │   ├── titles.ts                # buildTitle(toolName, toolInput) — Bash/Edit/Write/WebFetch/other
│   │   │   ├── rules.ts                 # buildPermissionRules(toolName, toolInput) — exact-match strings
│   │   │   ├── mdns.ts                  # bonjour-service: publish _watchcode._tcp.local; unpublish on stop
│   │   │   ├── pairing.ts               # 60s window state; 6-digit code; OK/expired/used predicates
│   │   │   ├── config.ts                # read/write ~/.watchcode/config.json (atomic via tmp+rename)
│   │   │   ├── pidfile.ts               # ~/.watchcode/daemon.pid; staleness check; signal handling
│   │   │   ├── logger.ts                # pino → ~/.watchcode/logs/daemon-YYYY-MM-DD.log + stderr in dev
│   │   │   └── types.ts                 # internal-only types (PendingApproval, WatchConn, SessionState)
│   │   └── test/
│   │       ├── queue.test.ts            # enqueue/resolve idempotence; concurrent resolve → first wins
│   │       ├── hmac.test.ts             # canonical bytes, replay rejection, mismatch logged not thrown
│   │       ├── transcript.test.ts       # slug extraction over fixtures; missing slug → undefined
│   │       ├── titles.test.ts           # one fixture per tool category
│   │       ├── rules.test.ts            # exact-match Bash/Edit/Write/WebFetch/other strings
│   │       ├── pairing.test.ts          # 60s expiry, replay of consumed code rejected
│   │       └── routes.test.ts           # supertest against http stack with mock queue
│   │
│   ├── hook/                            # per-permission subprocess: `npx watchcode hook`
│   │   ├── package.json                 # name: @watchcode/hook, bin: { "watchcode-hook": "dist/cli.js" }
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── cli.ts                   # entry; wires stdin → run() → stdout
│   │   │   ├── run.ts                   # main loop: baseline → POST → dual-poll → write decision
│   │   │   ├── transcriptWatcher.ts     # fs.statSync size delta vs baseline; threshold 100 bytes
│   │   │   ├── daemonClient.ts          # tiny fetch wrapper: POST /pending, GET /pending/:id/decision (long-poll 25s)
│   │   │   └── decision.ts              # toHookOutput(decision) — produces the JSON Claude Code expects
│   │   └── test/
│   │       ├── run.test.ts              # transcript grows mid-poll → exits silent; daemon resolves → emits JSON
│   │       └── decision.test.ts         # one snapshot per outcome (allow / allow+rules / deny / silent)
│   │
│   └── cli/                             # commander.js front door
│       ├── package.json                 # name: watchcode (THE published package), bin: { "watchcode": "dist/cli.js" }
│       ├── tsconfig.json
│       ├── src/
│       │   ├── cli.ts                   # commander wiring
│       │   ├── commands/
│       │   │   ├── start.ts             # idempotent merge into ~/.claude/settings.json + spawn daemon
│       │   │   ├── stop.ts              # POST /shutdown then SIGTERM PID; --keep-hook flag
│       │   │   ├── pair.ts              # POST /pair/begin → print code; poll /pair/status until paired/expired
│       │   │   ├── unpair.ts            # POST /pair/remove with name
│       │   │   ├── status.ts            # GET /status → table
│       │   │   ├── config.ts            # view + interactive edit (Zod-validated)
│       │   │   ├── logs.ts              # tail ~/.watchcode/logs/daemon-*.log; --follow
│       │   │   ├── test.ts              # POST /test
│       │   │   └── hook.ts              # delegate to @watchcode/hook (so `watchcode hook` works without npx)
│       │   ├── settingsJson.ts          # read/merge/write ~/.claude/settings.json with idempotent hook entry
│       │   ├── daemonHttp.ts            # localhost http client with friendly "daemon not running" error
│       │   └── output.ts                # chalk-free formatters; ascii tables; spinner abstraction
│       └── test/
│           ├── settingsJson.test.ts     # add hook to empty / existing / already-present settings; preserves siblings
│           └── start.test.ts            # spawns daemon stub; idempotent on second invocation
│
├── apps/
│   └── watch/                           # Wear OS Kotlin app — Gradle owns this subtree
│       ├── build.gradle.kts             # root project; AGP, Kotlin, Compose BOM
│       ├── settings.gradle.kts          # rootProject.name = "WatchCode"; includes :app
│       ├── gradle.properties            # JVM args, AndroidX flags
│       ├── gradle/wrapper/              # gradlew, wrapper jar
│       └── app/
│           ├── build.gradle.kts         # minSdk 30 (Wear OS 4), targetSdk 34, signingConfigs.debug for sideload
│           ├── proguard-rules.pro       # keep OkHttp, kotlinx.serialization
│           ├── src/main/
│           │   ├── AndroidManifest.xml  # FOREGROUND_SERVICE, WAKE_LOCK, INTERNET, CHANGE_WIFI_MULTICAST_STATE, foregroundServiceType=connectedDevice
│           │   ├── res/                 # icons, strings, themes
│           │   └── java/com/watchcode/
│           │       ├── MainActivity.kt              # single Activity hosting Compose nav
│           │       ├── WatchCodeApp.kt              # Application: DI graph init, encrypted prefs init
│           │       │
│           │       ├── service/
│           │       │   ├── ConnectionService.kt     # ForegroundService; owns WifiLock + WebSocket lifecycle
│           │       │   ├── ServiceState.kt          # enum: Searching, Pairing, Connected, Disconnected, Reconnecting
│           │       │   └── Notifications.kt         # ongoing notification text per state
│           │       │
│           │       ├── net/
│           │       │   ├── DaemonDiscovery.kt       # NsdManager wrapper, resolves _watchcode._tcp.local
│           │       │   ├── WatchSocket.kt           # OkHttp WebSocketListener; emits inbound msgs as Flow
│           │       │   ├── Reconnector.kt           # exponential backoff: 1s, 2s, 4s, 8s, 30s cap
│           │       │   └── Messages.kt              # kotlinx.serialization data classes mirroring shared/protocol.ts
│           │       │
│           │       ├── security/
│           │       │   ├── SecretStore.kt           # EncryptedSharedPreferences for HMAC secret + watch_id
│           │       │   ├── NonceCounter.kt          # monotonic int32 in EncryptedSharedPreferences
│           │       │   └── HmacSigner.kt            # signs canonical bytes, returns hex
│           │       │
│           │       ├── viewmodel/
│           │       │   ├── ApprovalViewModel.kt     # StateFlow<UiState>; consumes service flows
│           │       │   └── UiState.kt               # sealed: Searching/EnterCode/Queue(items, sessionCount)/Disconnected
│           │       │
│           │       └── ui/
│           │           ├── PairingScreen.kt         # 6-digit numeric pad
│           │           ├── QueueScreen.kt           # ScalingLazyColumn of cards
│           │           ├── ApprovalCard.kt          # slug + cwd pill + title + body + 3 buttons
│           │           └── theme/Theme.kt           # Wear Material colors
│           └── src/test/java/com/watchcode/
│               ├── HmacSignerTest.kt                # parity with daemon test vectors
│               ├── ReconnectorTest.kt               # backoff schedule
│               └── MessagesTest.kt                  # serialization round-trip
│
└── .github/
    └── workflows/
        ├── ci.yml                       # pnpm install → typecheck → test → lint, Node 20 + 22, macOS + Linux + Windows
        └── android.yml                  # Gradle assembleDebug; uploads APK as artifact on tag
```

---

## 2. Module dependency graph

```
              ┌──────────────────────────────┐
              │    @watchcode/shared         │   pure schemas + constants, no I/O
              └──────▲──────────▲──────────▲─┘
                     │          │          │
       ┌─────────────┘          │          └─────────────┐
       │                        │                        │
┌──────┴───────┐        ┌───────┴───────┐         ┌──────┴───────┐
│ @watchcode/  │        │ @watchcode/   │         │  watchcode   │
│   daemon     │        │    hook       │         │    (cli)     │
└──────────────┘        └──────┬────────┘         └──────┬───────┘
                               │ HTTP only               │ HTTP + spawn
                               └────────►   daemon  ◄────┘
```

**Allowed:**
- `daemon`, `hook`, `cli` all import from `shared`.
- `cli` may import from `hook` only to mount the `hook` subcommand under the `watchcode` binary (so `watchcode hook` works as a single static link). It must NOT import `daemon`.
- `hook` and `cli` reach `daemon` exclusively via HTTP on `127.0.0.1:9876`.

**Forbidden:**
- `cli` → `daemon` (direct import). Makes daemon impossible to swap, hides protocol.
- `daemon` → `hook` or `cli`. Daemon is a server; it has no awareness of who the client is.
- `shared` → anything. It is a leaf.
- Any package → Node-only API in `shared`. Keep `shared` Bun/Deno-portable and watch-side-mirror-able.

The Kotlin watch app does not consume any TS package; it manually mirrors `shared/protocol.ts` in `net/Messages.kt`. The `MessagesTest.kt` test is the cross-language contract: it parses fixtures the daemon emits in its own tests.

---

## 3. `packages/shared`

Single source of truth for the wire protocol and disk schemas. Pure Zod, no Node imports beyond `node:path`/`node:fs` in slug helper (which `daemon` re-exports — `hook` does not need slug logic).

### `src/constants.ts`
```ts
export const DAEMON_PORT = 9876;
export const MDNS_SERVICE_TYPE = "_watchcode._tcp";
export const MDNS_DOMAIN = "local";

export const HMAC_ALG = "sha256";
export const SECRET_BYTES = 32;
export const NONCE_MAX = 0xFFFFFFFF; // 32-bit monotonic

export const HOOK_TIMEOUT_SECONDS = 259200;          // 3 days, matches CC settings.json
export const HOOK_POLL_INTERVAL_MS = 1000;           // dual-poll cadence
export const HOOK_TRANSCRIPT_DELTA_BYTES = 100;      // local-response detection threshold
export const HOOK_LONGPOLL_TIMEOUT_MS = 25_000;      // single GET /pending/:id/decision call

export const DAEMON_HEARTBEAT_MS = 5_000;
export const PAIRING_WINDOW_MS = 60_000;
export const PAIRING_CODE_DIGITS = 6;

export const RECONNECT_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 30_000] as const;

export const PROTOCOL_VERSION = 1;
```

### `src/protocol.ts`
```ts
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

// daemon → watch
export const ApprovalRequestMsg = z.object({
  type: z.literal("approval_request"),
  id: z.string().uuid(),
  session: SessionInfo,
  tool: ToolInfo,
  timestamp: z.string(), // ISO-8601
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

// watch → daemon (HMAC-signed)
export const ApprovalResponseMsg = z.object({
  type: z.literal("approval_response"),
  request_id: z.string().uuid(),
  decision: z.enum(["approve", "always", "deny"]),
  nonce: z.number().int().nonnegative(),
  hmac: z.string().regex(/^[0-9a-f]{64}$/),
});

// First message a watch sends after WS connect, signed.
export const ClientHelloMsg = z.object({
  type: z.literal("client_hello"),
  watch_id: z.string().uuid(),
  protocol_version: z.number().int(),
  nonce: z.number().int().nonnegative(),
  hmac: z.string().regex(/^[0-9a-f]{64}$/),
});

export const DaemonToWatch = z.discriminatedUnion("type", [
  ApprovalRequestMsg,
  ApprovalResolvedMsg,
  DaemonStatusMsg,
]);

export const WatchToDaemon = z.discriminatedUnion("type", [
  ClientHelloMsg,
  ApprovalResponseMsg,
]);

export type ApprovalRequest = z.infer<typeof ApprovalRequestMsg>;
export type ApprovalResolved = z.infer<typeof ApprovalResolvedMsg>;
export type DaemonStatus = z.infer<typeof DaemonStatusMsg>;
export type ApprovalResponse = z.infer<typeof ApprovalResponseMsg>;
export type ClientHello = z.infer<typeof ClientHelloMsg>;
```

### `src/config.ts`
```ts
import { z } from "zod";

export const PairedWatch = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  secret: z.string(),                 // base64, 32 bytes decoded
  paired_at: z.string(),              // ISO-8601
  last_seen: z.string().nullable(),
  last_nonce: z.number().int().nonnegative().default(0),
});

export const WatchcodeConfig = z.object({
  daemon: z.object({
    port: z.number().int().positive().default(9876),
    mdns_name: z.string().default("watchcode"),
  }).default({}),
  watches: z.array(PairedWatch).default([]),
});

export type PairedWatch = z.infer<typeof PairedWatch>;
export type WatchcodeConfig = z.infer<typeof WatchcodeConfig>;

// Project override: <project_root>/.watchcode.json
export const ProjectOverride = z.object({ name: z.string().min(1) });
```

### `src/hookIo.ts`
Hook input is exactly what Claude Code sends to a `PermissionRequest` hook on stdin (per the official hooks doc). Hook output is the decision JSON. We accept extra fields (`.passthrough()`) so future Claude Code additions don't break parsing.

```ts
import { z } from "zod";

export const HookInput = z.object({
  hook_event_name: z.literal("PermissionRequest"),
  session_id: z.string(),
  transcript_path: z.string(),
  cwd: z.string(),
  tool_name: z.string(),
  tool_input: z.record(z.unknown()),
}).passthrough();

const AllowDecision = z.object({
  behavior: z.literal("allow"),
  permissionRules: z.array(z.string()).optional(),
  updatedInput: z.record(z.unknown()).optional(),
});
const DenyDecision = z.object({ behavior: z.literal("deny"), message: z.string().optional() });

export const HookOutput = z.object({
  hookSpecificOutput: z.object({
    hookEventName: z.literal("PermissionRequest"),
    decision: z.union([AllowDecision, DenyDecision]),
  }),
});

export type HookInput = z.infer<typeof HookInput>;
export type HookOutput = z.infer<typeof HookOutput>;
```

> Conflict watch: PRD §6 documents the `permissionRules: ["Bash(<exact command>)"]` shape verbatim from cc-remote-approval's expected behavior. The Claude Code hooks doc confirms `permissionRules` exists on the `allow` decision but the exact string grammar (`Bash(...)`, `Edit(...)`) needs to be validated empirically in Phase 1 against a live Claude Code session before the rules.ts implementation is finalized. Flagged in §12.

### `src/slug.ts`
JSONL transcripts contain entries; some early entries (system events, sidechain spawns) lack `slug`. Iterate from the top, return the first `slug` found, else `null`.

```ts
export function extractSlug(jsonlContent: string): string | null {
  for (const line of jsonlContent.split("\n")) {
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      if (typeof obj.slug === "string" && obj.slug.length > 0) return obj.slug;
    } catch { /* skip malformed line */ }
  }
  return null;
}
```

---

## 4. `packages/hook`

The `npx watchcode hook` subprocess. Exits 0 on every path Claude Code expects to handle (decision returned, or silent for local-resolution). Exits 0 silently on any failure — never block the user.

### `src/run.ts` — full lifecycle
```ts
export async function run(stdin: string, env = process.env): Promise<HookOutput | null> {
  // (a) parse input — bail silently on malformed
  const input = HookInput.safeParse(JSON.parse(stdin));
  if (!input.success) return null;
  const ev = input.data;

  // (b) baseline transcript size
  let baseline = 0;
  try { baseline = fs.statSync(ev.transcript_path).size; }
  catch { /* transcript may not exist yet — treat as 0 */ }

  // (c) POST to daemon — bail silently if down
  let id: string;
  try {
    id = await daemonClient.enqueue(ev);
  } catch {
    return null; // connection refused → native dialog handles
  }

  // (d) dual-poll loop until decision OR local-response detected
  const start = Date.now();
  const deadline = start + HOOK_TIMEOUT_SECONDS * 1000;

  while (Date.now() < deadline) {
    if (transcriptGrew(ev.transcript_path, baseline)) {
      // Tell daemon so it can mark resolved-by-local and broadcast to watches.
      daemonClient.markLocal(id).catch(() => {});
      return null; // (e) silent exit — native dialog response is authoritative
    }
    const decision = await daemonClient.pollDecision(id, HOOK_LONGPOLL_TIMEOUT_MS);
    if (decision) {
      // Re-check transcript: TOCTOU — local response might have arrived during long-poll
      if (transcriptGrew(ev.transcript_path, baseline)) {
        daemonClient.markLocal(id).catch(() => {});
        return null;
      }
      return toHookOutput(ev.tool_name, decision);
    }
    // pollDecision returned null (timeout); loop and re-check transcript at 1s cadence
    await sleep(HOOK_POLL_INTERVAL_MS);
  }
  return null;
}

function transcriptGrew(path: string, baseline: number): boolean {
  try { return fs.statSync(path).size >= baseline + HOOK_TRANSCRIPT_DELTA_BYTES; }
  catch { return false; }
}
```

### `src/decision.ts`
```ts
export function toHookOutput(toolName: string, d: DecisionFromDaemon): HookOutput {
  if (d.kind === "deny") {
    return { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny" } } };
  }
  if (d.kind === "always") {
    return { hookSpecificOutput: { hookEventName: "PermissionRequest",
      decision: { behavior: "allow", permissionRules: d.permissionRules } } };
  }
  return { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } };
}
```

### `src/daemonClient.ts`
- `enqueue(input)`: `POST http://127.0.0.1:9876/pending` body `{ session_id, transcript_path, cwd, tool_name, tool_input }` → `{ id, permissionRules? }`. The daemon (not the hook) builds the title and rules — the hook just relays the decision.
- `pollDecision(id, timeoutMs)`: `GET /pending/:id/decision?wait=25000`. Daemon holds the request open until decision lands or `wait` expires. Returns null on 204 (still pending).
- `markLocal(id)`: `POST /pending/:id/local-resolved`. Idempotent on the daemon side. Best-effort — fire-and-forget.

### Failure modes (hook)
| Situation | Behavior |
|---|---|
| Stdin malformed | Exit 0, empty stdout |
| Daemon connection refused | Exit 0, empty stdout (native dialog handles) |
| Daemon crashes mid-poll | Next poll throws; exit 0, empty stdout |
| Transcript grows ≥100 bytes | Notify daemon (best-effort), exit 0 silent |
| 3-day timeout reached | Exit 0, empty stdout (Claude Code applies its own timeout) |

---

## 5. `packages/daemon`

### HTTP API (loopback only, bound to 127.0.0.1)

| Method+Path | Body | Response | Purpose |
|---|---|---|---|
| `POST /pending` | `{ session_id, transcript_path, cwd, tool_name, tool_input }` | `{ id }` | Hook enqueues a permission request. Daemon ensures session is registered (lazy slug extract), constructs title + rules, broadcasts `approval_request` to all online watches. |
| `GET /pending/:id/decision?wait=25000` | — | `200 { kind, permissionRules? }` or `204` (timeout) or `404` (resolved-by-local: hook should exit silent) | Long-poll. Held until resolved or `wait` ms elapse. |
| `POST /pending/:id/local-resolved` | — | `204` | Hook signals local response. Daemon broadcasts `approval_resolved{resolved_by:"local"}` and removes from queue. Idempotent. |
| `POST /pair/begin` | — | `{ code: "482-159", expires_at }` | Open 60s pairing window. Errors with `409` if already open. |
| `GET /pair/status` | — | `{ state: "waiting" \| "paired" \| "expired", watch?: {...} }` | CLI polls this. |
| `POST /pair/complete` | `{ device_name, pairing_code }` | `{ watch_id, secret_b64 }` or `400` | Watch hits this. Validates code, mints 32-byte secret, persists. |
| `POST /pair/remove` | `{ name }` | `204` | `watchcode unpair`. |
| `GET /status` | — | `{ daemon_pid, watches: [...], pending: [...], sessions: [...] }` | `watchcode status`. |
| `POST /test` | `{ tool_name? }` | `204` | Inject a fake `approval_request` to all watches; auto-resolves after 30s. |
| `POST /shutdown` | — | `204` | Graceful shutdown. |

All non-loopback origins rejected at the HTTP layer (defense in depth — `bind 127.0.0.1` is primary).

### WebSocket server (`ws/`)

Same port, upgrade path `/ws`. On connect:
1. Connection enters `unauthenticated` state.
2. Watch must send `client_hello` within 5 s. Daemon looks up `watch_id` in config, verifies HMAC over canonical bytes, advances `last_nonce`. Failure → close 4001.
3. On success: connection moves to `authenticated`, daemon flushes any pending approvals (replay queue) to this watch, and starts heartbeat.

**Why connect-time auth (not just per-message):** prevents a hostile LAN peer from holding a connection open and consuming heartbeats. Per-message HMAC still applies to every `approval_response`.

> Conflict watch: PRD §6 doesn't explicitly mandate a `client_hello` — it says "watch → daemon messages carry HMAC and nonce". We add `client_hello` because without it the daemon doesn't know which watch a connection belongs to until the watch responds to an approval. Flagged in §12.

### In-memory queue (`queue.ts`)
```ts
type PendingApproval = {
  id: string;
  session_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  title: string;
  body: string;
  permissionRules: string[];        // pre-computed for "always"
  createdAt: number;
  resolver: (d: Decision | "local") => void;  // invoked by HTTP long-poll await
  resolved: boolean;
};

class Queue {
  private map = new Map<string, PendingApproval>();
  enqueue(p: PendingApproval): void;
  resolve(id: string, decision: Decision | "local"): boolean;  // returns false if already resolved (idempotent)
  list(): PendingApproval[];
  get(id): PendingApproval | undefined;
}
```

`resolve()` is the central idempotency point: first call wins, subsequent calls return `false` and are dropped silently. This is how "first responder wins" is implemented for both watch-vs-watch and watch-vs-local races.

### Sessions & transcript reader (`sessions.ts`, `transcript.ts`)
- On first `/pending` for a `session_id`: open `transcript_path`, scan for slug via `extractSlug()`, cache `{slug, transcript_path}` in `sessions` map.
- If slug not found yet (sidechain start, very early in session): cache `{slug: null}` and re-scan once on next `/pending` for the same session.
- `cwd_basename` is computed fresh per request (`path.basename(cwd)`).

### HMAC verifier (`hmac.ts`)
Canonical bytes (UTF-8, no whitespace):

```
v1\n
<type>\n
<watch_id>\n
<nonce>\n
<sha256-hex of canonical body JSON>
```

where canonical body JSON = `JSON.stringify(msg)` with `hmac` and `nonce` fields **removed** and remaining keys **sorted alphabetically**.

```ts
export function canonicalize(msg: object): Buffer {
  const { hmac: _, ...rest } = msg as any;
  const body = stableStringify(rest); // sorted keys
  const bodyHash = sha256hex(body);
  return Buffer.from(`v1\n${msg.type}\n${msg.watch_id ?? ""}\n${msg.nonce}\n${bodyHash}`, "utf8");
}

export function verifyAndAdvanceNonce(watch: PairedWatch, msg: any): boolean {
  if (msg.nonce <= watch.last_nonce) return false; // replay
  const expected = hmacHex(watch.secret, canonicalize(msg));
  if (!timingSafeEqual(expected, msg.hmac)) return false;
  watch.last_nonce = msg.nonce; // persist on next config flush
  return true;
}
```

Mismatch → log at `warn`, drop message, do **not** close connection (DOS resistance: a flaky LAN should not kill the WS).

### Title constructor (`titles.ts`)
```ts
export function buildTitle(toolName: string, input: Record<string, any>): string {
  switch (toolName) {
    case "Bash": {
      const desc = typeof input.description === "string" && input.description.trim();
      const cmd = typeof input.command === "string" ? input.command : "";
      return `Allow Claude to run "${desc || smartTrunc(cmd, 60)}"?`;
    }
    case "Edit":     return `Do you want to make this edit to ${basename(input.file_path)}?`;
    case "Write":    return `Do you want to create ${basename(input.file_path)}?`;
    case "WebFetch": return `Allow Claude to fetch ${urlHost(input.url)}?`;
    default:         return `Allow Claude to use ${toolName}?`;
  }
}
```

`body` is `smartTrunc(JSON-of-tool-input-condensed, 300)` with secret-masking applied.

### Permission rules constructor (`rules.ts`)
Exact-match only in v1. Must be byte-equal to the user's input so Claude Code's matcher applies on subsequent identical calls.

```ts
export function buildPermissionRules(toolName: string, input: Record<string, any>): string[] {
  switch (toolName) {
    case "Bash":     return [`Bash(${input.command})`];
    case "Edit":     return [`Edit(${input.file_path})`];
    case "Write":    return [`Write(${input.file_path})`];
    case "WebFetch": return [`WebFetch(${input.url})`];
    default:         return [`${toolName}`]; // tool-wide always
  }
}
```

> Conflict watch: the exact `Bash(...)`/`Edit(...)` grammar of `permissionRules` is not yet verified against a running Claude Code in this repo. Phase 1 must validate empirically; if the grammar differs, only `rules.ts` changes — the wire protocol is unaffected. Flagged in §12.

### mDNS (`mdns.ts`)
`bonjour-service` (mDNS lib that works on macOS without native deps). On daemon start:
```ts
const bonjour = new Bonjour();
const service = bonjour.publish({ name: cfg.daemon.mdns_name, type: "watchcode", port: 9876 });
```
Unpublish on shutdown. We do **not** advertise different TXT records for paired vs unpaired — pairing state is queried via the WS `client_hello`.

### Daemon process lifecycle (`pidfile.ts`, `index.ts`)
- PID file at `~/.watchcode/daemon.pid`.
- On `start`: if PID file exists and process is alive → exit "already running"; if stale → overwrite.
- Signal handlers: `SIGINT`/`SIGTERM` → stop heartbeat → close WS clients with code 1001 → unpublish mDNS → close HTTP → exit 0.
- Unhandled rejection / uncaught exception → log + exit 1 (process supervisor / shell-foreground operator restarts).
- Logs rotated daily (filename includes date); CLI `logs --follow` tails today's file.

---

## 6. `packages/cli`

`commander.js` with one root command `watchcode` and the subcommands below. Every command exits non-zero on user-facing failure. All HTTP errors are translated into a one-line friendly message ("Daemon isn't running. Try `watchcode start`.") with `--debug` revealing the underlying error.

### `start`
```
watchcode start [--port 9876]
```
1. Read `~/.claude/settings.json` (create if absent). Idempotent merge of the hook entry — see `settingsJson.ts` below.
2. Check PID file. If running → "Already running, PID xxx", exit 0.
3. Spawn daemon as detached child (`spawn(node, [daemonEntry], { detached: true, stdio: 'ignore' })`), unref, write PID.
4. Poll `GET /status` for up to 5 s. On success: print "WatchCode is running. Hook registered. Pair a watch with `watchcode pair`."

`settingsJson.ts` merge strategy:
- Read JSON.
- Find `hooks.PermissionRequest` array. If absent, create.
- Look for an entry whose `hooks[0].command` matches `^npx watchcode hook$|^watchcode hook$`. If present — leave alone (idempotent). If absent — append.
- Preserve all other keys, comments are lost (settings.json is plain JSON; we accept that).
- Atomic write: tmp file in same dir, fsync, rename.

### `stop`
```
watchcode stop [--keep-hook]
```
1. `POST /shutdown` (timeout 2 s). If 200 → wait for PID to exit (up to 5 s).
2. If still alive → `kill(pid, SIGTERM)`. Then `SIGKILL` after 3 s.
3. Unless `--keep-hook`: remove the watchcode entry from `~/.claude/settings.json`.
4. Remove PID file.

### `pair`
```
watchcode pair
```
1. `POST /pair/begin` → `{ code, expires_at }`. Print formatted code (`482-159`).
2. Print countdown spinner (60 s).
3. Poll `GET /pair/status` every 1 s.
4. On `paired` → print "✓ Galaxy Watch 6 paired" and exit. On `expired` → print "Pairing window expired" and exit 1.
5. SIGINT during wait → `POST /pair/cancel` (best-effort), exit 130.

### `unpair <name>`
`POST /pair/remove { name }`. Prints either "Removed" or "No watch named X".

### `status`
`GET /status`. Prints a compact ascii table:
```
WatchCode v1.0.0   running   PID 8421
─────────────────────────────────────
Watches:
  ✓ Galaxy Watch 6   online    last seen 2s ago
  ✗ Pixel Watch 2    offline   last seen 4h ago
Pending: 1
  • inherited-napping-eagle  Bash  "grep -h ..."  3s
Sessions: 2
```

### `config`
```
watchcode config            # print
watchcode config --edit     # interactive prompts for editable fields
```
Loads via Zod, prints any validation error pointing at the bad path. `--edit` only allows safe keys (port, mdns_name); `watches` is managed via pair/unpair only.

### `logs [--follow]`
Cats today's log file. `--follow` watches for new lines via `chokidar`.

### `test`
`POST /test`. Prints "Sent fake approval to N watches".

### `hook`
Internal. Delegates to `@watchcode/hook` `run()`. Exists so `watchcode hook` works as a single-binary entry without `npx`.

---

## 7. `apps/watch` (Wear OS Kotlin)

Single-Activity Compose app. All persistent connection logic lives in `ConnectionService`; UI is a thin `StateFlow` consumer.

### Foreground service lifecycle
States (`ServiceState.kt`):
```
Searching   — mDNS scanning
Pairing     — daemon found, no secret yet → user enters code
Connected   — WS open, authenticated (post client_hello ack)
Disconnected — explicit (user toggled off, or unpair received)
Reconnecting — transient: WS dropped, backoff timer ticking
```

State transitions emit a `Notifications.update(state)` so the ongoing notification reflects current status without separate channels.

### `ConnectionService`
- `onCreate`: acquire `WifiLock(WIFI_MODE_FULL_HIGH_PERF)`, build OkHttp client, register `NsdManager` listener.
- `onStartCommand`: idempotent — calling start while already running is a no-op.
- `onDestroy`: release lock, close socket.
- Crash recovery: declared `START_STICKY`. Android restarts on its own.

### `WatchSocket` (OkHttp)
```kotlin
class WatchSocket(private val url: HttpUrl, private val signer: HmacSigner) {
  private val client = OkHttpClient.Builder()
    .pingInterval(20, TimeUnit.SECONDS)  // OkHttp-level ping (separate from daemon_status heartbeat)
    .readTimeout(0, TimeUnit.MILLISECONDS) // streaming
    .build()

  val incoming: SharedFlow<DaemonToWatch> = ...
  fun send(msg: WatchToDaemon) { ws.send(signer.sign(msg).toJson()) }
}
```

### `Reconnector`
```kotlin
private val backoff = listOf(1_000L, 2_000L, 4_000L, 8_000L, 30_000L)
suspend fun loop() {
  var attempt = 0
  while (active) {
    try { connectAndPump() ; attempt = 0 }
    catch (e: Exception) {
      val delay = backoff[min(attempt, backoff.lastIndex)]
      attempt++
      delay(delay)
    }
  }
}
```

### mDNS via `NsdManager`
On state-enter `Searching` (first launch, post-disconnect, network change broadcast received): start discovery for `_watchcode._tcp.`. First resolved service with port 9876 wins; resolve to host+port; transition to `Pairing` if no secret stored, else `Connected`.

DHCP IP change: WS read fails → enters `Reconnecting` → next attempt re-runs mDNS resolution. No stored IP — robust by design.

### `ApprovalViewModel` + state model
```kotlin
sealed class UiState {
  object Searching : UiState()
  data class EnterCode(val daemonHostname: String) : UiState()
  data class Queue(val items: List<ApprovalRequest>, val sessionCount: Int) : UiState()
  data class Disconnected(val reason: String) : UiState()
}

class ApprovalViewModel(private val svc: ServiceBinder) : ViewModel() {
  val ui: StateFlow<UiState> = combine(svc.state, svc.queue, svc.heartbeat) { ... }
  fun respond(id: String, decision: Decision) { svc.send(ApprovalResponse(id, decision, nextNonce())) }
}
```

### Compose screens
- **PairingScreen** — 6 numeric tiles with a number pad; submits on 6th digit.
- **QueueScreen** — `ScalingLazyColumn { items(state.items) { ApprovalCard(it) } }`. Empty state composable.
- **ApprovalCard** — three full-width-stacked or compact-row buttons depending on body length; `Haptics.click()` on each press.

### HMAC + monotonic nonce
- Secret + watch_id stored in `EncryptedSharedPreferences` (`MasterKey.DEFAULT_MASTER_KEY_ALIAS`).
- Nonce stored in same prefs file under `nonce` key. `NonceCounter.next()` reads, increments, writes synchronously inside a `Mutex`. On approaching `Int.MAX_VALUE` (extremely unlikely — that's billions of approvals): force re-pair.
- Signing canonical bytes match daemon exactly — `HmacSignerTest.kt` ships a fixture that the daemon's `hmac.test.ts` also references.

### `approval_resolved` handling
On message receipt, the VM removes the matching id from the queue and triggers a brief haptic. If `resolved_by="local"` and the card was visible, animation explicitly indicates "resolved at PC" via a tinted dismiss; if `resolved_by="watch"` and decision matches what the user just tapped — silent.

---

## 8. Security details

| Threat | Mitigation |
|---|---|
| LAN attacker sends fake `approval_response` | HMAC-SHA-256 on canonical bytes; secret is per-watch, 32 random bytes from `crypto.randomBytes` |
| Replay of captured WS message | Monotonic 32-bit nonce; daemon stores `last_nonce` per watch; `nonce <= last_nonce` rejected |
| LAN attacker steals one nonce and races | Daemon advances `last_nonce` atomically before processing; the legitimate-but-late watch message arrives second and is dropped |
| Pairing-time MitM intercepts secret | 60 s window, 6-digit code displayed only on the host machine; out-of-band trust (user reads from terminal) |
| Replay of pairing code | Code consumed on first successful `POST /pair/complete` |
| Compromised PC | Out of scope — PC is the trust root |
| Hostile WS connection drains heartbeats | Connection requires `client_hello` within 5 s with valid HMAC; otherwise closed 4001 |
| HMAC mismatch as a DOS vector | Mismatch = drop+log, **never** disconnect (a 1-bit flip on lossy WiFi must not kick a paired watch) |

**Secret storage:**
- PC: `~/.watchcode/config.json` mode `0600`. Future v2 candidate: macOS Keychain / libsecret.
- Watch: `EncryptedSharedPreferences` (Tink-backed AES-GCM with hardware-keystore-wrapped master key).

**Canonical serialization** is defined in §5 (`hmac.ts`). The `v1` prefix lets us version the scheme without breaking paired watches.

---

## 9. Failure modes & recovery paths

| Scenario | Behavior |
|---|---|
| Daemon stopped while hook fires | `enqueue()` throws ECONNREFUSED → hook exits 0 silent → native dialog is the sole UI |
| Watch offline when approval enqueues | Queue retains entry; on reconnect, daemon flushes pending list to that watch (one `approval_request` per pending) |
| Watch responds but local already responded | Daemon's `queue.resolve()` returns false on second call → respond message dropped, watch will receive `approval_resolved{resolved_by:"local"}` from the broadcast and dismiss |
| HMAC mismatch | Drop, log at warn, do not close connection |
| Replayed nonce | Drop, log at warn, do not close connection |
| Network partition mid-WS | OkHttp ping timeout → onFailure → state = Reconnecting → backoff loop; foreground notification text reflects state |
| Multiple watches respond | First HMAC-valid `approval_response` wins via `queue.resolve()`; broadcast `approval_resolved` to all; other watches' UI dismisses card |
| DHCP IP change | WS read fails → reconnect path → mDNS re-resolves → reconnect to new IP. No stored IP anywhere |
| Transcript file missing/permission denied at hook start | Baseline=0; transcript-grew check is degraded but daemon long-poll still resolves |
| `~/.claude/settings.json` corrupted | `start` errors "settings.json invalid; please fix" before touching it. Never overwrites bad JSON |
| Two `watchcode start` invocations | Second sees PID file → "Already running, PID xxx" |
| Pairing code entered after 60 s | `POST /pair/complete` → 400 "expired or invalid" → watch shows "expired, run `watchcode pair` again" |
| Daemon crashes mid-pending | Queue is in-memory only — on restart, all pending are lost. Hooks long-polling are still running and will exit silent on next 1-s tick (transcript-grew or daemon-down). Acceptable for v1 |

---

## 10. Testing strategy

### Unit (per package)
- **shared:** every Zod schema round-trips fixture JSON; rejects extra fields where strict; passes through for `HookInput`.
- **daemon/queue:** enqueue/resolve idempotence; concurrent resolve from two callers — second returns false.
- **daemon/hmac:** signing fixtures match a Kotlin-side fixture (cross-language vector); replay rejection; mismatch returns false but does not throw.
- **daemon/transcript:** four fixture JSONLs covering: slug present on line 1, slug present on line 5, slug absent (returns null), malformed lines mixed in.
- **daemon/titles + rules:** one case per tool (Bash with/without description, Edit, Write, WebFetch, unknown).
- **daemon/pairing:** code generated, 60 s expiry, second `complete` rejected.
- **daemon/routes:** supertest happy-path + error cases.
- **hook/run:** simulate transcript growth → returns null; simulate decision returned → emits decision JSON; daemon-down → returns null.
- **cli/settingsJson:** add to empty file, file with other hooks, file with our hook already (idempotent), file with sibling top-level keys (preserved).

### Integration
`packages/daemon/test/integration.test.ts`:
1. Spin up real daemon on ephemeral port.
2. Open a WS as a "mock watch" (with a pre-installed paired entry in test config).
3. POST `/pending` as if from the hook.
4. Assert `approval_request` received on WS.
5. Send signed `approval_response`.
6. Assert long-poll on `GET /pending/:id/decision` resolves with the decision.
7. Assert `approval_resolved` broadcast arrives on the WS.

### Manual E2E checklist (PRD §17 derived)
- [ ] `npm install -g watchcode && watchcode start && watchcode pair` → first approval in <5 min.
- [ ] Native dialog still renders identically with daemon running and idle.
- [ ] Two paired watches → both receive request → first responder wins.
- [ ] Stop daemon → trigger Bash → native dialog only, no hook delay.
- [ ] Watch offline → trigger 3 approvals → bring watch online → all 3 appear.
- [ ] Respond at PC during a request → watch card disappears within 1 s.

---

## 11. Build & CI

### pnpm workspace
- `pnpm install` at root installs everything and links workspace packages.
- `pnpm -r build` runs `tsc -b` across `shared` → `daemon` / `hook` / `cli` (project refs handle ordering).
- `pnpm -r test` runs vitest in each package.

### npm publishing (the `watchcode` package)
The published package is `packages/cli` only, but it bundles everything:
- `cli/package.json` declares `dependencies: { "ws", "bonjour-service", "commander", "uuid", "zod" }` and `bin: { watchcode: "dist/cli.js" }`.
- Pre-publish step: `pnpm -r build`, then `cli` is bundled with esbuild to a single `dist/cli.js` that inlines `@watchcode/shared`, `@watchcode/daemon`, `@watchcode/hook`. Workspace deps are stripped from the published manifest.
- Files published: `dist/`, `README.md`, `LICENSE`. Tests, sources, configs excluded via `.npmignore` / `package.json#files`.

### Watch APK
- Gradle `assembleDebug` produces a debug-signed APK in `apps/watch/app/build/outputs/apk/debug/`.
- A long-lived debug keystore is committed at `apps/watch/keystore/debug.keystore` (debug only — never shipped for release).
- `watchcode pair` prints the GitHub Releases URL where the APK is attached.

### GitHub Actions matrix
**`ci.yml`** (every PR + main):
- OS: `ubuntu-latest`, `macos-latest`, `windows-latest`.
- Node: `20`, `22`.
- Steps: setup pnpm → install → `pnpm -r typecheck` → `pnpm -r test` → `pnpm -r lint`.

**`android.yml`** (every PR + main):
- `ubuntu-latest`, JDK 17, Android SDK.
- `cd apps/watch && ./gradlew assembleDebug testDebugUnitTest`.
- On tag `v*`: upload signed-debug APK as release asset.

---

## 12. Questions for the spec author

These do not block Phase 1 scaffolding but must be resolved before Phase 1 is "done":

1. **`permissionRules` grammar.** PRD §6 documents `["Bash(<exact command>)"]` and analogous strings for Edit/Write/WebFetch. We have not validated this against a live Claude Code session in this repo. Phase 1 should run a quick spike: emit `permissionRules: ["Bash(echo hello)"]` from a hook and verify a subsequent identical `Bash(echo hello)` is auto-approved. If the grammar differs (e.g., requires JSON object form, or different tool keys), only `daemon/rules.ts` and the related tests change.

2. **Daemon learning of local resolution.** PRD §5C says the hook detects local response via transcript-size growth and exits silent. But the daemon also needs to know — to broadcast `approval_resolved{resolved_by:"local"}` so the watch dismisses its card. We propose `POST /pending/:id/local-resolved` from the hook (best-effort, fire-and-forget) before silent exit. PRD does not name this endpoint; confirm the design or propose an alternative (e.g., daemon polls transcript itself).

3. **Watch WebSocket auth at connect time.** PRD §6 specifies HMAC + nonce on each watch→daemon message but does not say how the daemon knows which paired watch a fresh WS connection belongs to. We propose a signed `client_hello` as the first frame within 5 s of connection, otherwise close 4001. If the spec prefers identifying the watch lazily (only on first `approval_response`), the heartbeat would have to fan out to anonymous connections, which we consider a small DOS surface.

4. **Slug for sessions where no entry has one yet.** Some early sessions never write a slug-bearing entry until the first user message. Until then, the watch shows `cwd_basename` only. Confirm this fallback is acceptable (PRD §10 implies slug is the heading; cwd is the secondary pill).

5. **`.watchcode.json` discovery.** PRD §7 says project-level override at `<project_root>/.watchcode.json`. The hook receives `cwd` from Claude Code; we can walk up from there to find `.watchcode.json`. Confirm walking upward (vs. exact `cwd` match) is the intended behavior.

None of the above changes the file layout, the wire protocol shape, or the Phase 1 scaffolding plan. Resolve them inline as Phase 1 lands, before Phase 2 ships.
