# Slice 5 — Multi-session, multi-watch, .watchcode.json override

**Type:** AFK  
**GitHub:** [K-Khushal/watchcode#6](https://github.com/K-Khushal/watchcode/issues/6)  
**Status:** ready-for-agent

---

## Parent

#1

## What to build

Production-readiness pass for concurrency. After this slice the system handles 3+ concurrent Claude Code sessions and 2+ paired watches gracefully, and the project name override mechanism works.

Scope:
- **Multi-session**: when multiple `claude` sessions run simultaneously, each fires its own hook and registers its own pending approval. The daemon's `Queue` keys entries by `request_id` (not session) so they coexist. Each `approval_request` payload carries its own session label (slug + cwd basename) — the watch shows them all in the queue, distinguishable.
- **Multi-watch broadcast + first-wins**: when 2+ watches are paired and online, every `approval_request` fans out to all of them. The first to respond wins — daemon resolves once, broadcasts `approval_resolved` to all watches, others' cards auto-dismiss. Subsequent responses for the same `request_id` are silently dropped (idempotent resolve).
- **`.watchcode.json` upward discovery**: from the hook's `cwd`, walk up the directory tree until either a `.watchcode.json` is found or the filesystem root is reached. If found, parse and use `name` as the session label, overriding the slug. Cache the discovery per `(cwd, file mtime)` to avoid repeated filesystem walks.

## Acceptance criteria

- [ ] Run 3 concurrent `claude` sessions in different directories; each requests a tool — all 3 approval requests appear simultaneously on the watch with distinct slug labels
- [ ] Responding to one of the 3 (Approve/Deny on watch or PC) does not affect the other two — they remain pending until individually resolved
- [ ] Pair 2 watches; trigger a single approval — both watches buzz and show the same card within 3s
- [ ] First watch responds with Approve: tool runs, second watch's card auto-dismisses with haptic within 1s, second watch's response (sent slightly later) is silently dropped
- [ ] Race test: two watches respond near-simultaneously — `Queue.resolve` is idempotent, only the first decision applies, no duplicate side effects
- [ ] Project with `.watchcode.json` containing `{"name":"Customer API"}` at its root: hook fires from a deep subdirectory, daemon walks upward, finds the file, watch displays "Customer API" instead of the cwd basename pill (and instead of slug? — confirm the priority in `docs/protocol.md`: `.watchcode.json` overrides slug as the heading, cwd pill becomes irrelevant)
- [ ] No `.watchcode.json` anywhere in the path: walk stops at filesystem root, falls back to slug + cwd basename per #4 behavior
- [ ] Manual e2e: 3 sessions × 2 watches all working from the same `watchcode start` instance

## Blocked by

#5

