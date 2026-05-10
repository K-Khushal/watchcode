# Slice 2 spike — manual e2e demo

This is the load-bearing acceptance step for [slice 2](issues/02-end-to-end-approval-spike.md). It proves
the parallel-hook architecture against real Claude Code: a hook-injected
`permissionRules` value must cause Claude Code's matcher to auto-approve
subsequent identical requests in the same session.

The TS side cannot verify this on its own — only a live `claude` CLI
session can. Run this once whenever the rule grammar or hook
integration changes.

## Pre-flight

- Node ≥ 20, pnpm ≥ 9
- The `claude` CLI installed and working (`claude --version`)
- `jq` and `curl` on `$PATH`

```sh
pnpm install
pnpm -r build
pnpm vitest run        # 49 tests should pass
```

## Run the demo

The runner registers the watchcode hook in `~/.claude/settings.json`,
starts the daemon, and live-tails the queue. **It modifies your real
`~/.claude/settings.json` for the duration of the demo and removes its
entry on exit (Ctrl+C).** To run sandboxed:

```sh
CLAUDE_HOME=/tmp/claude-spike ./scripts/spike-demo.sh
```

For the real check (since Claude Code reads from `~/.claude/settings.json`):

```sh
./scripts/spike-demo.sh
```

You'll see something like:

```
============================================================
  watchcode spike demo
  daemon pid: 12345  port: 9876
  WATCHCODE_HOME: /tmp/tmp.XYZ/wc
  CLAUDE_HOME:    /Users/you/.claude
  log: /tmp/tmp.XYZ/wc/logs/daemon.log
============================================================
...
------------------- live status (polls every 1s) -------------------
{"daemon_pid":12345,"version":"0.0.0","pending":[]}
```

## Drive the demo

In **terminal 2**, start a Claude Code session in any directory:

```sh
cd /tmp && claude
```

Ask Claude to run a Bash command:

> please run `echo hello`

Claude will request `Bash` permission, the hook will fire, and you'll
see the entry appear in the live status pane in terminal 1:

```
{"daemon_pid":12345,"pending":[{"id":"abc-123-...","tool_name":"Bash","title":"Allow Claude to run \"echo hello\"?",...}]}
```

In **terminal 3**, grab the id and inject `always`:

```sh
ID=$(curl -s http://127.0.0.1:9876/status | jq -r '.pending[0].id')
curl -X POST -H 'content-type: application/json' \
  -d '{"decision":"always"}' \
  http://127.0.0.1:9876/pending/$ID/decision
```

The hook in terminal 2 will return its decision JSON to Claude Code,
which runs `echo hello` and prints `hello`.

## The actual gate

Now ask Claude in the **same session** to run **the exact same command**:

> please run `echo hello`

**Expected:** Claude runs the command immediately. **No** new entry
appears in terminal 1's queue. **No** dialog appears in terminal 2.

If that happens, the spike passes — Claude Code's matcher accepted
`Bash(echo hello)` from `permissionRules` and applied it to the next
identical call.

## What if it fails

Two failure modes worth distinguishing:

1. **Second `echo hello` triggers the hook again** (a new entry shows
   up in terminal 1). Means Claude Code didn't accept the rule. Check
   the daemon log:

   ```sh
   tail -n 50 /tmp/tmp.*/wc/logs/daemon.log
   ```

   The `enqueue` log line shows what the daemon computed, e.g.
   `permissionRules: ["Bash(echo hello)"]`. If the literal string is
   correct but Claude Code still re-prompted, the grammar differs from
   our assumption. Inspect `~/.claude/settings.json` — Claude Code
   should have appended the rule under
   `permissions.allow` (or wherever the docs say). Whatever's actually
   there is the canonical grammar; update
   [packages/daemon/src/rules.ts](../packages/daemon/src/rules.ts) and
   [docs/protocol.md](protocol.md) to match.

2. **Hook never fires** (no entry in terminal 1 even on the first
   request). Means Claude Code didn't load the hook. Check:

   ```sh
   cat ~/.claude/settings.json | jq .hooks.PermissionRequest
   ```

   The watchcode entry should be present. If it is, run `claude
   --debug` (or whatever flag your version uses) to see what hooks it
   loaded.

## Cleanup

`Ctrl+C` in terminal 1. The runner:

- Sends SIGTERM to the daemon (5s grace, then SIGKILL).
- Strips the watchcode hook entry from `~/.claude/settings.json`,
  leaving any unrelated entries intact.

If anything is left behind, manually:

```sh
# Stop daemon
pkill -f 'packages/daemon/dist/index.js' || true

# Remove hook (one-liner)
node -e "const fs=require('fs');const p=process.env.HOME+'/.claude/settings.json';const o=JSON.parse(fs.readFileSync(p,'utf8'));const l=(o.hooks?.PermissionRequest||[]).filter(e=>!(e.hooks||[]).some(h=>(h.command||'').includes('packages/hook/dist/cli.js')));if(l.length)o.hooks.PermissionRequest=l;else delete o.hooks?.PermissionRequest;fs.writeFileSync(p,JSON.stringify(o,null,2)+'\n');"
```

## Recording the result

Tick the spike checkbox in [issues/02-end-to-end-approval-spike.md](issues/02-end-to-end-approval-spike.md)
once you've verified the rule round-trips. If the grammar was different
from the assumption, commit the update to
[`docs/protocol.md`](protocol.md) and `rules.ts` in the same PR.
