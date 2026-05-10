# WatchCode — Build Plan

**Companion to:** [PRD-watchcode.md](../PRD-watchcode.md) v2.0, [ARCHITECTURE.md](ARCHITECTURE.md).
**Goal:** sequenced, verifiable task list. Each task has a clear "done when" check. Tasks are sized to ~half a day. The order is optimised for a runnable end-to-end skeleton early, then layering in security and polish.

**Phase-to-PRD mapping.** PRD §14 splits work into Phases 1–5. This plan refines that into 7 milestones (M0–M6). M0 is repo scaffold (one shot), M1 is the slice-of-the-cake end-to-end loop without security, M2 brings the watch online, M3 adds pairing + HMAC, M4–M6 polish, ship.

**Open questions resolved before Phase 1.** ARCHITECTURE.md §12 flagged 5 — answers locked here so they don't reappear:

1. **`permissionRules` grammar** — accept the proposal: emit string-form `["Bash(<exact command>)"]` and verify with a Phase-1 spike.
2. **Daemon learns of local resolution** — accept `POST /pending/:id/local-resolved` from the hook, best-effort fire-and-forget right before silent exit.
3. **Watch WS auth at connect time** — accept signed `client_hello` within 5 s, otherwise close 4001.
4. **Slug fallback** — accept: when no slug present yet, watch shows only the cwd pill until the first slug-bearing entry; cache and re-use thereafter.
5. **`.watchcode.json` discovery** — walk upward from `cwd`, like `.git`/`.gitignore` discovery. Stop at filesystem root.

---

## M0 — Repo scaffold (½ day)

| # | Task | Done when |
|---|---|---|
| 0.1 | `pnpm init`; create `pnpm-workspace.yaml`, `tsconfig.base.json`, `.eslintrc.cjs`, `.prettierrc`, `.gitignore`, `.npmrc`, `LICENSE` (MIT), empty `README.md` | `pnpm install` succeeds with no warnings |
| 0.2 | Create `packages/shared`, `packages/daemon`, `packages/hook`, `packages/cli` with empty `src/index.ts`, individual `tsconfig.json` (composite), individual `package.json` referencing `@watchcode/shared` workspace dep where needed | `pnpm -r build` produces `dist/` in every package |
| 0.3 | Create `apps/watch/` Gradle skeleton (Wear OS module). Use Android Studio template "Wear OS Empty App" with min SDK 30, target SDK 34. Add `.gradle`/`build/`/`*.apk` to `.gitignore` | `./gradlew assembleDebug` produces an APK that installs and shows "Hello WatchCode" on Galaxy Watch 6 |
| 0.4 | Add `docs/` directory; copy this plan and ARCHITECTURE.md in. Add empty `protocol.md`, `threat-model.md`, `watch-install.md`, `CONTRIBUTING.md` placeholders | `ls docs/` shows all five |
| 0.5 | Initial commit "scaffold" | Branch is clean, tree matches ARCHITECTURE §1 layout |

---

## M1 — End-to-end skeleton (no security, no mDNS, no watch) — 2 days

The shortest path to a working approve-via-HTTP loop. Validates the parallel-hook architecture before building UI.

| # | Task | Depends on | Done when |
|---|---|---|---|
| 1.1 | `shared/src/constants.ts` — port, mDNS type, poll interval, transcript threshold (100), reconnect backoff array, hook timeout (259200) | M0 | Constants exported, no behavior |
| 1.2 | `shared/src/hookIo.ts` — Zod schemas for hook stdin (Claude Code's PermissionRequest input) and stdout (`hookSpecificOutput.decision.{behavior, permissionRules}`) | 1.1 | Schemas parse a hand-crafted real Claude Code hook input JSON |
| 1.3 | `shared/src/protocol.ts` — Zod schemas for `approval_request`, `approval_resolved`, `daemon_status`, `approval_response` (HMAC fields optional for now) | 1.1 | `pnpm -F @watchcode/shared test` passes a roundtrip parse/serialize for each message |
| 1.4 | `daemon/src/queue.ts` — in-memory `Map<uuid, PendingApproval>` with `enqueue`, `resolve` (idempotent), `findByRequestId`, list-by-session | 1.3 | Unit tests cover idempotent double-resolve, ordering, removal-on-resolve |
| 1.5 | `daemon/src/http.ts` — Express/Fastify on `127.0.0.1:9876`. Endpoints: `POST /pending`, `GET /pending/:id/decision` (long-poll, 25 s), `POST /pending/:id/local-resolved`, `GET /status` | 1.4 | `curl` exercises the full lifecycle: enqueue → long-poll blocked → manually inject decision → response unblocks |
| 1.6 | `daemon/src/index.ts` — wire HTTP, log to `~/.watchcode/logs/daemon.log`, handle SIGTERM/SIGINT graceful shutdown, write PID file at `~/.watchcode/daemon.pid` | 1.5 | `node packages/daemon/dist/index.js` starts, accepts requests, exits cleanly on Ctrl+C |
| 1.7 | `hook/src/run.ts` — read stdin, parse with `hookIo` schema, capture `transcript_path` baseline size, POST `/pending`, dual-poll loop (transcript size + decision long-poll), emit decision JSON or silent exit, fire `/local-resolved` before silent exit | 1.5 | `echo '<sample input>' \| node packages/hook/dist/index.js` exits with correct stdout when daemon returns `approve` via curl-injected decision |
| 1.8 | `cli/src/commands/start.ts` — start daemon as detached process, write hook entry to `~/.claude/settings.json` idempotently (read, merge, write), report daemon status | 1.6 | `watchcode start` registers hook; restarting it doesn't duplicate the hook entry |
| 1.9 | `cli/src/commands/stop.ts` — read PID file, send SIGTERM, wait, optionally `--keep-hook` | 1.6 | After `stop`, `daemon.pid` is gone and port 9876 is free |
| 1.10 | `cli/src/commands/test.ts` — POST a fake `approval_request` to the daemon and print whatever decision is injected via curl back-channel (acts as a watch-mock) | 1.5 | Useful for the next milestone |
| 1.11 | **Spike: `permissionRules` grammar.** Run a real Claude Code session, register the hook, make Claude run a command, hook returns `permissionRules: ["Bash(echo hello)"]`. Verify subsequent identical `Bash(echo hello)` is auto-approved. Document the actual format if different | 1.7, 1.8 | Either confirmed grammar matches PRD §6 or grammar is corrected and `daemon/src/rules.ts` updated |
| 1.12 | **End-to-end manual test: claude-code → hook → daemon → curl-injected decision → claude-code unblocks** | 1.7, 1.8 | `claude` runs a tool, terminal dialog appears, separately `curl -X POST localhost:9876/pending/<id>/decision -d '{"decision":"approve"}'` causes the dialog to dismiss and the tool to proceed |

**M1 acceptance:** the parallel-hook architecture is proven against real Claude Code. No UI, no security — but the load-bearing claim of the entire project is now verified.

---

## M2 — Watch slice (no security, no mDNS) — 3 days

Get the watch displaying real approval cards and responding via plain WebSocket. mDNS still deferred — use a hardcoded `192.168.x.x:9876` config in the watch app for now.

| # | Task | Depends on | Done when |
|---|---|---|---|
| 2.1 | `daemon/src/ws.ts` — `ws` server, fan-out `approval_request` to all clients on enqueue, broadcast `approval_resolved` on resolve, heartbeat `daemon_status` every 5 s | 1.4 | `wscat -c ws://127.0.0.1:9876` receives heartbeats and approval requests |
| 2.2 | `daemon/src/sessions.ts` + `transcript.ts` — slug extractor that scans transcript JSONL for first entry with `slug` field, caches by `session_id`, falls back to `cwd_basename` when slug absent | 1.7 | Unit test against a captured `.jsonl` file extracts the right slug |
| 2.3 | `daemon/src/titles.ts` — title constructor for Bash (uses `description`), Edit, Write, WebFetch, other (per ARCHITECTURE §5 / PRD §10) | 1.3 | Unit tests cover all 5 cases |
| 2.4 | `daemon/src/rules.ts` — exact-match permissionRules constructor for each tool | 1.11 result | Unit tests cover Bash, Edit, Write, WebFetch, generic |
| 2.5 | Wire 2.2/2.3 into `POST /pending` so the daemon emits enriched `approval_request` payloads to WS clients | 2.1, 2.2, 2.3 | `wscat` shows realistic-looking cards |
| 2.6 | `apps/watch` package layout under `com.watchcode.{service,net,ui,viewmodel,security}` per ARCHITECTURE §7 | M0 | Project compiles |
| 2.7 | `ConnectionService` (foreground service) with persistent ongoing notification ("WatchCode connected"), holds `WifiLock` | 2.6 | Service stays alive in background; ADB shows it running after locking the watch |
| 2.8 | `WatchSocket` (OkHttp) — connect to hardcoded URL from BuildConfig, parse incoming JSON via Moshi/kotlinx.serialization, emit a `Flow<ServerEvent>` | 2.7 | Watch logs the heartbeat from the daemon every 5 s |
| 2.9 | `Reconnector` — exponential backoff `[1, 2, 4, 8, 30]` s, observes WiFi state, reconnects on resume | 2.8 | Pulling daemon down, then back up: watch reconnects within 30 s |
| 2.10 | `ApprovalViewModel` + `StateFlow<List<ApprovalRequest>>` with add/remove by `request_id`, plus a `connectionState` flow | 2.8 | Unit test covers add/remove |
| 2.11 | `QueueScreen` (`ScalingLazyColumn` of `ApprovalCard`) + `ApprovalCard` with slug heading, cwd pill, title, body, three buttons (Deny / Always / Approve) | 2.10 | Watch displays a real card sent from `wscat` or `watchcode test` |
| 2.12 | Tap handlers — `WatchSocket.send(approval_response{...})` (no HMAC yet) → daemon resolves → daemon broadcasts `approval_resolved` → card removes with subtle haptic | 2.11, 2.1 | Tap Approve on watch → curl-watching session sees the tool unblock |
| 2.13 | **End-to-end: real Claude Code → hook → daemon → watch → tap Approve → tool runs** | 2.12, 1.12 | Demo-able. PRD US-03/05 satisfied without security. |

**M2 acceptance:** the watch is a full participant. No security yet — anyone on `127.0.0.1` could approve. That's M3.

---

## M3 — Pairing + HMAC + mDNS — 2 days

Lock down the system. After M3, only paired watches with valid secrets can respond.

| # | Task | Depends on | Done when |
|---|---|---|---|
| 3.1 | `shared/src/protocol.ts` — finalise `client_hello` schema (`{ watch_id, nonce, hmac }` over canonical bytes), make `nonce` and `hmac` required on `approval_response` | 1.3 | Schemas updated, unit tests pass |
| 3.2 | `daemon/src/hmac.ts` — canonical byte string `v1\n<type>\n<watch_id>\n<nonce>\n<sha256-body>`, `verify(message, secret)` returns boolean, replay-protection via `last_nonce` per watch | 3.1 | Unit tests cover happy path, mismatch, replay |
| 3.3 | `daemon/src/config.ts` — `~/.watchcode/config.json` reader/writer with Zod, never logs `secret` (mask in any log emission) | 3.1 | Unit tests cover round-trip + masking |
| 3.4 | `daemon/src/ws.ts` — require signed `client_hello` within 5 s of connect; close 4001 otherwise. After hello, lookup secret from config and use it for all subsequent inbound message verification | 3.2, 3.3 | Connection without hello dies; with bad HMAC dies; with valid hello + nonce passes |
| 3.5 | `cli/src/commands/pair.ts` — open 60 s window, generate 6-digit code, print to terminal, expose `POST /pair/complete?code=XXXXXX` on daemon, on success generate 32-byte secret + watch entry, return secret to watch | 3.3 | `watchcode pair` shows code, accepts an HTTP call with the right code, persists watch entry |
| 3.6 | `cli/src/commands/unpair.ts` — remove watch entry from config; daemon picks up via watcher or signal | 3.3 | Unpaired watch's next connection is rejected |
| 3.7 | Watch `PairingScreen` — input field for code, submit POSTs to daemon's pairing endpoint, on success store secret in `EncryptedSharedPreferences`, navigate to `QueueScreen` | 3.5 | Pairing flow completes end-to-end on real device |
| 3.8 | Watch `Hmac.kt` + monotonic-nonce file in `EncryptedSharedPreferences` — increment-and-persist before every send; HMAC every outbound `client_hello` and `approval_response` | 3.7 | Wireshark/log inspection shows correct signature on every message |
| 3.9 | `daemon/src/mdns.ts` — `bonjour-service` advertise `_watchcode._tcp.local` on port 9876; deregister on shutdown | M0 | `dns-sd -B _watchcode._tcp` shows the service |
| 3.10 | Watch `ServiceDiscovery.kt` (`NsdManager`) — find `_watchcode._tcp.local`, resolve to host, replace hardcoded BuildConfig URL | 2.8, 3.9 | Cold start: app finds daemon without manual config |
| 3.11 | **End-to-end: pair → unpair → re-pair on a fresh watch install** | 3.7, 3.8, 3.10 | Each cycle works; replayed nonces are rejected; tampered HMACs are dropped |

**M3 acceptance:** v1 security model live. No more open `wscat` access.

---

## M4 — Multi-session, multi-watch, edge cases — 1.5 days

| # | Task | Done when |
|---|---|---|
| 4.1 | Spike concurrent sessions: run 3 Claude Code sessions in parallel, each making tool calls. Verify queue tagging, slug extraction, and per-card session label | All 3 sessions visible on watch with distinct slugs |
| 4.2 | Spike multi-watch: pair 2 watches, run 1 session, verify both watches receive each request and first responder wins | Watch A taps Approve, Watch B's card auto-dismisses within 1 s |
| 4.3 | `.watchcode.json` upward-walking discovery in daemon (override slug as session label) | Override displayed correctly |
| 4.4 | Local-response detection edge cases: simulate transcript that grows slightly less than threshold, exactly at threshold, far above | Threshold of 100 bytes works without false positives in 100 trials |
| 4.5 | Failure-mode test matrix from ARCHITECTURE §9: daemon stop, watch offline, mid-flight network drop, DHCP IP change, HMAC mismatch, replayed nonce. Each one's behaviour matches the matrix | All cases pass |

---

## M5 — Polish + remaining CLI — 2 days

| # | Task | Done when |
|---|---|---|
| 5.1 | `cli/src/commands/status.ts` — daemon state, paired watches with online/offline marker (last `client_hello` time), pending queue summary, active sessions | Output is concise and accurate |
| 5.2 | `cli/src/commands/config.ts` — view + interactive edit (Zod-validated), masks `secret` field | Editing through the CLI never produces an invalid config |
| 5.3 | `cli/src/commands/logs.ts` — tail the daemon log, optional `--follow` | Behaves like `tail -f` |
| 5.4 | `cli/src/commands/test.ts` (final form) — sends a synthetic `approval_request` to all watches; useful for testing pairing / connectivity | Watch buzzes with a "Test approval — tap any button" card |
| 5.5 | README.md (install / pair / daily-use, <5 min read) | First-time user can pair and approve in <5 min |
| 5.6 | docs/protocol.md (frozen wire reference; mirrors ARCHITECTURE §3 with version banner) | Independent reader can implement a third-party client |
| 5.7 | docs/threat-model.md (what HMAC + pairing protect; what they don't — compromised PC, sniffed local WiFi pre-pairing, etc.) | Honest, no overselling |
| 5.8 | docs/watch-install.md (sideload guide: enable Wear OS dev mode, ADB connect, install APK from GitHub release) | Step-by-step, with screenshots if possible |
| 5.9 | CONTRIBUTING.md (dev setup, PR conventions, how to run the test matrix) | Anyone can run the test suite locally |

---

## M6 — Release — 1 day

| # | Task | Done when |
|---|---|---|
| 6.1 | GitHub Actions: matrix for Node 20/22 on ubuntu/macos/windows running daemon + cli + hook + shared tests | Green on push to `main` |
| 6.2 | GitHub Actions: Android build check (Gradle assembleDebug) on ubuntu | Green |
| 6.3 | npm publish dry run — verify the published bundle contains the right files (esbuild-inlined daemon binary, hook binary, CLI), nothing extraneous | `npm pack` output is small and correct |
| 6.4 | Build signed-debug APK, attach to a `v1.0.0-rc1` GitHub release, link from `watchcode pair` output | Fresh device install works from the link |
| 6.5 | Smoke test: clean macOS + clean Windows VM. `npm install -g watchcode@1.0.0-rc1 && watchcode start && watchcode pair && claude` → first approval works in <5 min | Two passes, both successful |
| 6.6 | Tag `v1.0.0`, `npm publish`, attach final APK to GitHub release | Tagged, published, downloadable |

---

## Dependency graph (high level)

```
M0 (scaffold)
 │
 ├──▶ M1.1-1.3 (shared schemas) ──▶ M1.4-1.7 (daemon HTTP + hook + queue) ──▶ M1.11-1.12 (live spike)
 │                                                                                    │
 │                                                                                    ▼
 │                                                                                M2 (watch)
 │                                                                                    │
 │                                                                                    ▼
 │                                                                            M3 (security)
 │                                                                                    │
 │                                                                                    ▼
 │                                                                              M4 (edges)
 │                                                                                    │
 │                                                                                    ▼
 └──────────────────────────────────────────────────────────────────────▶  M5 (polish) ──▶ M6 (release)
```

**Critical insight from the slice-of-the-cake ordering:** M1.11 (the `permissionRules` spike) is intentionally early — it's the only PRD claim that hasn't been verified against live Claude Code, and it could invalidate `rules.ts` design. Discover this in M1, not M5.

---

## Daily test rituals

After M2 lands, every commit should be smoke-tested with:

1. `pnpm -r build && pnpm -r test`
2. `watchcode start && watchcode pair` on a paired test watch
3. `claude` → request a tool → resolve from watch
4. `claude` → request a tool → resolve from terminal (verify watch dismisses)

A 60-second smoke test catches 90% of regressions.

---

## Estimated total effort

~12 days of focused engineering for a solo developer comfortable with TS + Kotlin. Watch app is the long pole (Wear OS dev cycle is slow). Add 30% buffer for Wear OS surprises (dozing, WiFi lock interactions on real Galaxy Watch firmware).

**Best-case shipping target:** 3 weeks from M0 commit to v1.0.0 tag.
