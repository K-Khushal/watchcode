# Slice 6 — Failure-mode hardening pass

**Type:** AFK  
**GitHub:** [K-Khushal/watchcode#7](https://github.com/K-Khushal/watchcode/issues/7)  
**Status:** ready-for-agent

---

## Parent

#1

## What to build

Dedicated rigor pass that verifies every failure mode listed in `docs/ARCHITECTURE.md` §9. After this slice the system is honest about its safety story: WatchCode's failure always falls back to native dialog, never silently allows or denies (PRD US-34 — the load-bearing safety property).

Each case below requires a test (unit, integration, or documented manual reproduction) and a one-paragraph entry in `docs/threat-model.md` describing the case and the observed mitigation.

## Failure-mode matrix to cover

1. **Daemon stopped while hook fires**: hook gets `ECONNREFUSED`, exits 0 with empty stdout, native dialog handles unchanged.
2. **Daemon crashes mid-approval (after `POST /pending` succeeded but before `/decision` long-poll resolves)**: hook's long-poll returns connection-reset, hook exits 0 with empty stdout, native dialog still pending.
3. **Watch offline when approval arrives**: daemon enqueues normally; on watch reconnect (after `client_hello`), daemon re-fans-out any unresolved pending approvals from its in-memory queue.
4. **PC + watch race (simultaneous responses)**: `Queue.resolve` is idempotent — only the first decision counts; the loser's response is dropped silently. Both surfaces still receive `approval_resolved`.
5. **Network partition mid-WebSocket**: `Reconnector` engages exponential backoff `[1, 2, 4, 8, 30]` s; foreground service notification reflects "Reconnecting…"; recovers when network returns; in-flight `approval_response` is retransmitted on reconnect (idempotent at daemon).
6. **DHCP IP change (PC's IP shifts mid-session)**: watch detects WS close, re-resolves daemon via `NsdManager`, reconnects to new address.
7. **HMAC mismatch (tampered or malformed message)**: daemon drops the frame, logs a warning, leaves the connection open. Verify by injecting a hand-crafted bad message — connection persists.
8. **Replayed nonce**: same — drop, log, do not disconnect.
9. **Watch sends `client_hello` after >5 s**: daemon closes with code 4001.
10. **`.watchcode.json` malformed (bad JSON, wrong shape)**: Zod rejects, daemon falls back to slug + cwd_basename, logs the failure once per session.
11. **Hook timeout reached (3 days elapsed with no decision)**: hook subprocess is killed by Claude Code; native dialog stays as the source of truth (this is the documented behavior, not an action — verify it doesn't crash the daemon or leave queue entries permanently).
12. **Local-response race (transcript grew between two file-size checks)**: TOCTOU re-check pattern — re-read the size right before declaring a decision from the daemon to avoid overwriting a local response that landed in parallel.

## Acceptance criteria

- [ ] All 12 cases above have an explicit test (unit/integration/manual) and the test passes
- [ ] `docs/threat-model.md` describes each case in one paragraph: trigger, observed behavior, why it's safe
- [ ] Daemon log entries for the drop-and-don't-disconnect cases (HMAC mismatch, replayed nonce, malformed `.watchcode.json`) are clear and grep-able
- [ ] No code path can result in silent auto-allow or auto-deny — every failure either (a) defers to the native dialog or (b) drops with a logged warning
- [ ] Concurrency stress test: 100 parallel `enqueue`+`resolve` cycles with a 50/50 mix of watch-wins and PC-wins, no duplicate `approval_resolved` broadcasts, no leaked queue entries

## Blocked by

#6

