# Slice 7 — Remaining CLI commands + docs

**Type:** AFK  
**GitHub:** [K-Khushal/watchcode#8](https://github.com/K-Khushal/watchcode/issues/8)  
**Status:** ready-for-agent

---

## Parent

#1

## What to build

Round out the CLI surface and write the user-facing docs. After this slice a first-time user can install WatchCode and reach their first approval in under 5 minutes by following the README.

## CLI commands

- **`watchcode status`**: queries the daemon's `GET /status` and prints daemon state (running/version/uptime), paired watches with each watch's online/offline marker (based on last `client_hello` or last heartbeat ack within ~10 s), pending queue summary (count + per-session breakdown), and active sessions
- **`watchcode logs [--follow]`**: tails `~/.watchcode/logs/daemon.log`. With `--follow`, behaves like `tail -f`
- **`watchcode test`**: pushes a synthetic `approval_request` to all paired watches via the daemon — useful for testing connectivity without invoking Claude Code. The card on the watch shows "Test approval — tap any button"
- **`watchcode config`**: `view` mode prints the config (with `secret` masked as `***`); `edit` mode opens `$EDITOR` and re-validates with Zod on save (rejects invalid changes and prints the validation error)

## Documentation deliverables

- **`README.md`** (top-level): install (`npm i -g watchcode`), `watchcode start`, `watchcode pair`, install APK, daily use. Should read in <5 minutes.
- **`docs/protocol.md`**: frozen wire reference. Documents the WS message types, HTTP endpoints, HMAC canonical bytes, mDNS service name, all constants. A third-party developer should be able to implement an alternate watch client from this doc alone.
- **`docs/threat-model.md`**: what HMAC + the pairing window protect (network attackers, drive-by pairing on shared WiFi, replay attacks). What they don't (a compromised PC running the daemon — secrets are at rest unencrypted in `config.json`; a packet sniffer during the 60-second pairing window before HMAC is established). Honest, no overselling. Builds on the failure-mode write-ups from #7.
- **`docs/watch-install.md`**: step-by-step APK sideload guide — enable Wear OS developer mode, ADB pair over WiFi, `adb install`. Screenshots if practical.
- **`docs/CONTRIBUTING.md`**: dev setup (`pnpm install`, build commands), how to run the test suite, PR conventions, where issues are tracked.

## Acceptance criteria

- [ ] `watchcode status` shows accurate output: daemon version, paired watches with online/offline marker, pending queue count, active sessions
- [ ] `watchcode logs --follow` streams new log lines in real time; Ctrl+C exits cleanly
- [ ] `watchcode test` causes every paired online watch to buzz with a "Test approval" card; tapping any button completes silently (no Claude Code session involved)
- [ ] `watchcode config view` masks every `secret` field; `watchcode config edit` opens `$EDITOR` and rejects invalid Zod schemas with a clear error
- [ ] `README.md` walks a new user from `npm i -g watchcode` to first approval in <5 minutes (timed manually)
- [ ] `docs/protocol.md` is complete enough that a third-party watch client could be written without reading source
- [ ] `docs/threat-model.md` honestly enumerates threats covered and not covered
- [ ] `docs/watch-install.md` works end-to-end on a clean Galaxy Watch 6
- [ ] `docs/CONTRIBUTING.md` lets a new contributor run the full test suite locally

## Blocked by

#7

