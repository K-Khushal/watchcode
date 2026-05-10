# Slice 4 — Pairing + HMAC + mDNS

**Type:** AFK  
**GitHub:** [K-Khushal/watchcode#5](https://github.com/K-Khushal/watchcode/issues/5)  
**Status:** ready-for-agent

---

## Parent

#1

## What to build

Lock down the system. After this slice, the daemon refuses unauthenticated connections, every watch→daemon message is HMAC-signed and replay-protected, and the watch finds the daemon via mDNS instead of a hardcoded URL. The `BuildConfig.DAEMON_URL` placeholder from #4 is removed.

Scope:
- **Pairing flow**:
  - `watchcode pair` opens a 60-second pairing window, generates a 6-digit code (zero-padded), and prints it: `Pairing code: 482-159 (60s remaining)`.
  - Daemon exposes `POST /pair/complete` that accepts `{ code, device_name }`, validates the code, generates a 32-byte secret, persists `{ id, name, secret, paired_at, last_seen, last_nonce: 0 }` to `~/.watchcode/config.json` (Zod-validated, secret never logged), and returns `{ watch_id, secret }`.
  - Outside the 60s window the endpoint rejects with 403.
  - Watch's `PairingScreen`: input field for the 6-digit code, POST to daemon, on success store `(watch_id, secret)` in `EncryptedSharedPreferences`.
- **HMAC + nonce**:
  - Canonical bytes for both `client_hello` and `approval_response`: `v1\n<type>\n<watch_id>\n<nonce>\n<sha256-hex-of-body-json-without-hmac-field>`.
  - HMAC-SHA-256 over those bytes, hex-encoded, included as `hmac` field.
  - Watch maintains a monotonic `last_nonce` in `EncryptedSharedPreferences`; increments and persists before each send.
  - Daemon stores `last_nonce` per watch; rejects messages with `nonce <= last_nonce` (drop + log + do not disconnect).
  - HMAC mismatch: drop + log + do not disconnect (DOS prevention).
- **Connection auth**:
  - First WS frame from watch must be a signed `client_hello{watch_id, nonce, hmac}` within 5 seconds. Otherwise daemon closes with code 4001.
  - After hello, daemon looks up secret from config and verifies all subsequent inbound messages.
- **mDNS**:
  - Daemon advertises `_watchcode._tcp.local` on port 9876 via `bonjour-service` (note: the `mdns` npm package is unmaintained on macOS — use `bonjour-service`).
  - Watch uses `NsdManager` to discover the service. If multiple daemons advertise, the user picks one in `PairingScreen`.
  - Replaces `BuildConfig.DAEMON_URL` from #4.
- **Unpair**: `watchcode unpair <name>` removes the watch entry from config; the daemon's next inbound message from that watch fails secret-lookup and the connection is closed.
- **Module built**: `HmacVerifier` (interface from PRD §Implementation Decisions).

## Acceptance criteria

- [ ] `watchcode pair` prints a 6-digit pairing code and a 60-second countdown; window closes cleanly when expired
- [ ] Successful pair: daemon writes a watch entry with a 32-byte secret to `~/.watchcode/config.json`; secret never appears in logs
- [ ] Pair attempts outside the 60s window are rejected with 403
- [ ] Watch stores secret in `EncryptedSharedPreferences`; reinstalling the app requires re-pairing
- [ ] Every watch→daemon message is HMAC-SHA-256 signed over the canonical byte string in PRD §Implementation Decisions
- [ ] First WS frame must be a signed `client_hello` within 5s; otherwise daemon closes 4001
- [ ] Replayed nonce: dropped, logged, connection stays open
- [ ] HMAC mismatch: dropped, logged, connection stays open (verify by sending a hand-crafted bad message — connection persists)
- [ ] mDNS via `bonjour-service`: `dns-sd -B _watchcode._tcp` shows the service on macOS / equivalent on Linux/Windows
- [ ] Watch discovers daemon via `NsdManager` cold-start (no hardcoded URL anywhere in the APK)
- [ ] DHCP IP change: watch reconnects to the new address via mDNS without manual intervention (test: change daemon machine's IP via VPN or static reassignment)
- [ ] `watchcode unpair "Galaxy Watch 6"` removes the entry; the watch's next reconnect fails authentication
- [ ] Unit tests: `HmacVerifier` (happy path, signature mismatch, replayed nonce, nonce-window edge cases `<=` vs `<`), config Zod round-trip + secret masking
- [ ] Manual e2e: cold install on watch → mDNS discovery → enter 6-digit code → paired → signed traffic verified by inspecting daemon log

## Blocked by

#4

