# WatchCode — dev setup

End-to-end guide for running the daemon, wiring the Claude Code hook, building
the watch app, and triggering an approval round-trip on an emulator or a
physical Galaxy Watch.

Aligned with slice 3 (no security yet). Slice 4 adds HMAC + pairing + mDNS
discovery; slice 7 automates daemon + hook lifecycle via the `watchcode` CLI.

---

## Prerequisites

- macOS or Linux
- Node 20+ (`node --version`)
- pnpm 9+ (`pnpm --version`)
- JDK 17 (the Gradle toolchain auto-resolves it via foojay)
- Android SDK + ADB. Easiest install is Android Studio → preferences → SDK Manager.
  Add `$HOME/Library/Android/sdk/platform-tools` to `PATH` or use the
  `ANDROID_HOME=$HOME/Library/Android/sdk` prefix below.
- A Wear OS device — either an **AVD** (Wear OS 4+, API 33+) or a **physical
  watch** with developer options + ADB-over-WiFi enabled.

---

## 1. Build everything

```bash
cd watchcode
pnpm install
pnpm -r build
```

This produces:
- `packages/daemon/dist/index.js` — the daemon entry point
- `packages/hook/dist/cli.js` — the Claude Code PermissionRequest hook
- `packages/shared/dist/*` — wire-protocol schemas

---

## 2. Start the daemon

### Loopback-only (default — emulator only)

```bash
node packages/daemon/dist/index.js
```

Binds to `127.0.0.1:9876`. Reachable from the host machine and any Android
emulator (via the QEMU NAT alias `10.0.2.2`). **Not** reachable from a physical
watch on the LAN.

### LAN-accessible (physical watch)

```bash
WATCHCODE_HOST=0.0.0.0 node packages/daemon/dist/index.js
```

Slice 3 has no WS authentication — only use this on a trusted network. Slice 4
adds per-watch HMAC and re-tightens the WS gate.

Optional: `WATCHCODE_PORT=9999 ...` to change the port (default 9876).

### Logs

Structured JSON, one line per event:

```bash
tail -f ~/.watchcode/logs/daemon.log
```

Useful filters:
```bash
# enqueue/resolve only
tail -f ~/.watchcode/logs/daemon.log | grep -E 'enqueue|resolve'
```

### Stop the daemon

```bash
pkill -f 'daemon/dist/index.js'
```

The in-memory queue is lost on restart — that's intentional for slice 3.

---

## 3. Wire the Claude Code hook (interim — slice 7 automates)

Slice 7 will ship `watchcode start` which writes the hook entry idempotently.
Until then, edit `~/.claude/settings.json` by hand:

```json
{
  "hooks": {
    "PermissionRequest": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node /ABSOLUTE/PATH/TO/watchcode/packages/hook/dist/cli.js",
            "timeout": 259200
          }
        ]
      }
    ]
  }
}
```

The 259200 s (3-day) timeout matches the slice 6 design: the hook can block
indefinitely while waiting for a watch response because the user can always
respond at the native PC dialog as a fallback.

**To remove**: delete the `PermissionRequest` entry. (Slice 7's `watchcode stop`
will handle this automatically.)

---

## 4. Watch setup

### 4a. Wear OS emulator (AVD)

Create a Wear OS AVD in Android Studio (API 33+ recommended). Launch it, then:

```bash
cd apps/watch
ANDROID_HOME=$HOME/Library/Android/sdk ./gradlew :app:installDebug
adb shell am start -n com.watchcode/.MainActivity
```

`BuildConfig.DAEMON_URL` defaults to `ws://10.0.2.2:9876/ws` — the emulator's
NAT route to the host's `127.0.0.1`. Works with the loopback-only daemon.

### 4b. Physical watch (ADB over WiFi)

Pair once via Developer Options → Wireless debugging on the watch:

```bash
adb pair <watch-ip>:<pair-port>     # enter the 6-digit code shown on the watch
adb connect <watch-ip>:<connect-port>
adb devices                         # confirm the watch is listed
```

Find your Mac's LAN IP:
```bash
ipconfig getifaddr en0              # or en1 if on Ethernet
```

Build + install the APK with that IP baked in:

```bash
cd apps/watch
ANDROID_HOME=$HOME/Library/Android/sdk \
  ./gradlew :app:installDebug -PdaemonUrl=ws://<your-mac-ip>:9876/ws
adb shell am start -n com.watchcode/.MainActivity
```

The daemon must be running with `WATCHCODE_HOST=0.0.0.0` (see §2).

On first launch the watch requests `POST_NOTIFICATIONS` — tap **Allow** so the
heads-up notification (with inline Approve / Always / Deny chips) can fire.

---

## 5. Verify connectivity

```bash
# Daemon is listening
lsof -i :9876 | grep LISTEN

# WS hand-shake from the host
node -e '
  const WS = require("/path/to/watchcode/node_modules/.pnpm/ws@8.20.0/node_modules/ws");
  const ws = new WS("ws://127.0.0.1:9876/ws");
  ws.on("message", m => { console.log(JSON.parse(m.toString())); ws.close(); });
'

# Watch process + WS lifecycle
PID=$(adb shell pidof com.watchcode | tr -d '\r')
adb logcat -d -v threadtime --pid=$PID | grep -E 'WatchSocket|WatchCodeService'
```

You should see `daemon_status` heartbeats every ~5 s.

---

## 6. Trigger a test approval

### Synthetic (skip the hook, simulate `/pending`)

```bash
curl -s -X POST http://127.0.0.1:9876/pending \
  -H 'content-type: application/json' \
  -d '{
    "session_id": "test",
    "transcript_path": "/tmp/empty.jsonl",
    "cwd": "/tmp",
    "tool_name": "Bash",
    "tool_input": {"command": "ls -la", "description": "List files"}
  }'
```

The watch should buzz; tap **Approve**, **Always**, or **Deny** on the heads-up
notification (or open the WatchCode app to see the queued card).

### Real Claude Code session

After §3 is done, just start `claude` and ask for something that needs a
permission:

```text
> Please run `node --version` for me
```

Claude pauses → watch buzzes within ~3 s → tap a chip → tool runs.

---

## 7. Run the tests

```bash
# TypeScript: daemon + shared schemas + hook (62 tests)
pnpm test

# Kotlin: Reconnector backoff + WiFi-resume short-circuit (3 tests)
cd apps/watch
ANDROID_HOME=$HOME/Library/Android/sdk ./gradlew :app:testDebugUnitTest \
  --tests "com.watchcode.net.ReconnectorTest"
```

---

## 8. Troubleshooting

| Symptom | Check |
|---|---|
| Watch sticks on "Connecting…" | Daemon bound to `127.0.0.1` only. Restart with `WATCHCODE_HOST=0.0.0.0`. |
| Watch never buzzes after `curl /pending` | Confirm the watch app process is running: `adb shell pidof com.watchcode`. Check logcat for `WatchSocket: ws open`. |
| `curl` to `http://<LAN-IP>:9876/...` returns `loopback only` | Working as designed — HTTP routes are loopback-only (the hook always runs on the same host). The watch uses WS, which has no IP restriction. |
| Heads-up disappears before you tap | Wear OS auto-dismisses after a few seconds. Open the WatchCode app to see the still-queued card. |
| Real `claude` session doesn't trigger the watch | Was Claude started **before** you wrote `~/.claude/settings.json`? Restart `claude`. |
| Watch reconnect takes longer than expected | The Reconnector uses backoff `[1, 2, 4, 8, 30]` s. Worst-case 30 s on the 5th+ attempt. WiFi resume short-circuits the wait. |
| Build fails with "fun Project.android is deprecated" | You're on AGP 9 with an old DSL. Migrate `kotlinOptions {}` to `kotlin { compilerOptions { jvmTarget.set(...) } }`. |
| Real watch can't pair (`adb pair` hangs) | Watch + Mac must be on the same WiFi SSID, no client isolation. |

---

## 9. Known slice-3 limitations

- **No WS authentication.** Anyone on the LAN can connect, observe approval
  requests, and inject responses. Slice 4 (#5) adds HMAC + pairing.
- **No queue replay on reconnect.** Approvals enqueued before the watch
  connects do not appear retroactively. Slice 6 (#7) adds replay.
- **Hardcoded daemon URL in `BuildConfig`.** Pass `-PdaemonUrl=...` at build
  time. Slice 4 replaces this with mDNS auto-discovery.
- **Hook registration is manual.** Slice 7 (#8) ships `watchcode start` which
  edits `~/.claude/settings.json` idempotently.
- **HTTP API is loopback-only.** Cannot move the hook off-host. By design —
  the hook is part of the same trust domain as the daemon.

---

## 10. Clean shutdown

```bash
# Stop the daemon (queue is in-memory; this clears it)
pkill -f 'daemon/dist/index.js'

# Stop the watch app
adb shell am force-stop com.watchcode

# Remove the hook entry from ~/.claude/settings.json (manual until slice 7)
```
