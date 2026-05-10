# Slice 3 — Watch displays real cards and responds (no security yet)

**Type:** AFK  
**GitHub:** [K-Khushal/watchcode#4](https://github.com/K-Khushal/watchcode/issues/4)  
**Status:** ready-for-agent

---

## Parent

#1

## What to build

Bring the watch online as a real approval surface. After this slice, a developer can tap Approve / Always / Deny on a Galaxy Watch 6 and Claude Code unblocks. No security yet — watch connects to a hardcoded daemon URL via `BuildConfig`. mDNS and pairing land in #5.

Scope:
- **Daemon**: WebSocket server on the same port `9876` (HTTP and WS coexist). Fan-out `approval_request` to all connected WS clients on enqueue. Broadcast `approval_resolved{request_id, resolved_by, decision}` on every queue resolution (including local). Heartbeat `daemon_status` every 5s.
- **Daemon enrichment** before fan-out: read transcript JSONL to extract Claude's `slug` (cache by `session_id`; iterate past entries that lack `slug`; fall back to `cwd_basename` only when no slug exists yet). Compute native-style `title` per tool (Bash uses `tool_input.description`; Edit/Write use file basename; WebFetch uses URL host; generic for the rest, see PRD §Implementation Decisions). Compute `body` (truncated tool input).
- **Modules built**: `SlugExtractor`, `TitleBuilder` (RulesBuilder is referenced from #3's spike outcome and used here for "Always" — exact-match form from PRD).
- **Wear OS app**: package layout `com.watchcode.{service,net,ui,viewmodel,security}`. Foreground service (`ConnectionService`) holding a `WifiLock`, persistent ongoing notification "WatchCode connected". `WatchSocket` (OkHttp) connects to URL from `BuildConfig.DAEMON_URL` (placeholder until #5 adds mDNS), emits `Flow<ServerEvent>`. `Reconnector` with exponential backoff `[1, 2, 4, 8, 30]` s, observes WiFi state. `ApprovalViewModel` with `StateFlow<List<Approval>>` and `connectionState`. Three Compose screens: `QueueScreen` (`ScalingLazyColumn` of cards), `ApprovalCard` (slug heading + cwd basename pill + native-style title + body + three buttons Deny / Always / Approve), placeholder `PairingScreen` (real flow in #5).
- **Tap behavior**: button → send `approval_response{request_id, decision}` (no HMAC yet) → daemon resolves → daemon broadcasts `approval_resolved` → all watches remove the card with subtle haptic.

## Acceptance criteria

- [ ] Daemon WebSocket server on port 9876 broadcasts heartbeat every 5s and fans out approval_request to all connected clients
- [ ] Approval requests arrive at the watch enriched: real slug (from transcript JSONL), cwd basename pill, native-style title per tool, body
- [ ] Long body truncates with ellipsis at ~300 chars
- [ ] Galaxy Watch 6 (or Wear OS 4 emulator) launches app → foreground service starts → persistent notification appears → WebSocket connects to hardcoded URL
- [ ] Tap Approve on watch: tool runs, card removes with haptic
- [ ] Tap Deny on watch: tool blocks, card removes
- [ ] Tap Always on watch: tool runs and an exact-match `permissionRules` rule auto-approves the next identical call
- [ ] Local response (user types at PC dialog): daemon broadcasts `approval_resolved{resolved_by:"local"}`, watch card auto-dismisses within 1s (PRD US-26)
- [ ] WiFi drop and recovery: watch reconnects within 30s using exponential backoff
- [ ] Foreground service notification reflects connection state (connected / disconnected / reconnecting)
- [ ] Unit tests: `SlugExtractor` (slug found, slug never present, cache hit), `TitleBuilder` (one per tool), `Reconnector` (Kotlin — backoff sequence, WiFi-resume short-circuit, success resets)
- [ ] Manual e2e: real `claude` session → tool requested → watch buzzes within 3s → tap Approve → tool runs

## Blocked by

#3

