#!/usr/bin/env bash
# Slice 2 manual demo runner.
#
# Boots a daemon against an isolated $WATCHCODE_HOME, registers the hook in
# $CLAUDE_HOME (defaults to ~/.claude — pass an empty/test dir if you don't
# want to touch your real settings), and prints the curl commands you need
# to drive the spike.
#
# Usage:
#   ./scripts/spike-demo.sh                # uses ~/.claude (live session)
#   CLAUDE_HOME=/tmp/cc ./scripts/spike-demo.sh   # sandboxed
#
# Cleanup is automatic on Ctrl+C.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

WATCHCODE_HOME="${WATCHCODE_HOME:-$(mktemp -d)/wc}"
CLAUDE_HOME="${CLAUDE_HOME:-$HOME/.claude}"
PORT="${PORT:-9876}"

mkdir -p "$WATCHCODE_HOME"
mkdir -p "$CLAUDE_HOME"

DAEMON_ENTRY="$ROOT/packages/daemon/dist/index.js"
HOOK_ENTRY="$ROOT/packages/hook/dist/cli.js"
SETTINGS="$CLAUDE_HOME/settings.json"

if [[ ! -f "$DAEMON_ENTRY" || ! -f "$HOOK_ENTRY" ]]; then
  echo "[spike] building packages..."
  pnpm -r build >/dev/null
fi

# ---------- register hook (idempotent) ----------
HOOK_CMD="node '$HOOK_ENTRY'"
SETTINGS_PATH="$SETTINGS" HOOK_CMD="$HOOK_CMD" node <<'NODE_EOF'
const fs = require('fs');
const path = process.env.SETTINGS_PATH;
const cmd = process.env.HOOK_CMD;
const existing = fs.existsSync(path)
  ? JSON.parse(fs.readFileSync(path, 'utf8') || '{}')
  : {};
const list = (existing.hooks && existing.hooks.PermissionRequest) || [];
const already = list.some((e) => (e.hooks || []).some((h) => h.command === cmd));
if (!already) {
  list.push({ matcher: '', hooks: [{ type: 'command', command: cmd, timeout: 259200 }] });
  existing.hooks = { ...(existing.hooks || {}), PermissionRequest: list };
  fs.writeFileSync(path, JSON.stringify(existing, null, 2) + '\n');
  console.log('[spike] hook registered in', path);
} else {
  console.log('[spike] hook already registered in', path);
}
NODE_EOF

# ---------- start daemon ----------
LOG="$WATCHCODE_HOME/logs/daemon.log"
mkdir -p "$WATCHCODE_HOME/logs"
WATCHCODE_HOME="$WATCHCODE_HOME" node "$DAEMON_ENTRY" >>"$LOG" 2>&1 &
DAEMON_PID=$!
sleep 0.5

if ! kill -0 "$DAEMON_PID" 2>/dev/null; then
  echo "[spike] daemon failed to start. log:"
  cat "$LOG"
  exit 1
fi

cleanup() {
  echo
  echo "[spike] stopping daemon (pid $DAEMON_PID)..."
  kill -TERM "$DAEMON_PID" 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    kill -0 "$DAEMON_PID" 2>/dev/null || break
    sleep 0.1
  done
  kill -KILL "$DAEMON_PID" 2>/dev/null || true
  # Strip the hook from settings.json
  SETTINGS_PATH="$SETTINGS" node <<'NODE_EOF' || true
const fs = require('fs');
const path = process.env.SETTINGS_PATH;
if (!fs.existsSync(path)) process.exit(0);
const obj = JSON.parse(fs.readFileSync(path, 'utf8') || '{}');
const list = (obj.hooks && obj.hooks.PermissionRequest) || [];
const next = list.filter(
  (e) =>
    !(e.hooks || []).some((h) =>
      ((h.command || '').includes('@watchcode/hook') ||
        (h.command || '').includes('packages/hook/dist/cli.js')),
    ),
);
if (next.length === list.length) process.exit(0);
if (next.length === 0) {
  delete obj.hooks.PermissionRequest;
  if (obj.hooks && Object.keys(obj.hooks).length === 0) delete obj.hooks;
} else {
  obj.hooks.PermissionRequest = next;
}
fs.writeFileSync(path, JSON.stringify(obj, null, 2) + '\n');
console.log('[spike] hook removed from', path);
NODE_EOF
}
trap cleanup EXIT INT TERM

cat <<EOF

============================================================
  watchcode spike demo
  daemon pid: $DAEMON_PID  port: $PORT
  WATCHCODE_HOME: $WATCHCODE_HOME
  CLAUDE_HOME:    $CLAUDE_HOME
  log: $LOG
============================================================

In another terminal, run a 'claude' session (use 'claude' CLI as normal)
and ask it to run a Bash command, e.g.:

    please run: echo hello

When the hook is invoked, it will appear in the queue. From this
terminal, you will see live status below. To drive the demo, in
another terminal:

  # 1. See the pending id:
  curl -s http://127.0.0.1:$PORT/status | jq .

  # 2. Inject an 'always' decision (replace <ID>):
  curl -X POST -H 'content-type: application/json' \\
    -d '{"decision":"always"}' \\
    http://127.0.0.1:$PORT/pending/<ID>/decision

  # 3. In the claude session, ask for the SAME command again.
  #    Expected: auto-approved, no dialog, no hook log entry.

  # Other useful injections:
  #   {"decision":"approve"}   one-shot allow
  #   {"decision":"deny"}      block this call

Ctrl+C to stop and unregister the hook.

------------------- live status (polls every 1s) -------------------
EOF

while true; do
  if ! kill -0 "$DAEMON_PID" 2>/dev/null; then
    echo "[spike] daemon exited unexpectedly. tail of log:"
    tail -n 20 "$LOG"
    exit 1
  fi
  STATUS="$(curl -s "http://127.0.0.1:$PORT/status" || true)"
  printf "\033[2K\r%s" "${STATUS:-<no response>}"
  sleep 1
done
