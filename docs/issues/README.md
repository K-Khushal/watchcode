# WatchCode v1 — vertical slices

This directory mirrors the issues opened on the [GitHub issue tracker](https://github.com/K-Khushal/watchcode/issues) so the work plan is browsable inside the repo.

**Source PRD:** [#1 — WatchCode v1 — Bridge Claude Code permission requests to a Galaxy Watch](https://github.com/K-Khushal/watchcode/issues/1) (also see [PRD-watchcode.md](../../PRD-watchcode.md))
**Build plan:** [BUILD-PLAN.md](../BUILD-PLAN.md) — task-level milestone view that aligns with these slices
**Architecture:** [ARCHITECTURE.md](../ARCHITECTURE.md)

Each file follows the [`/to-issues` skill template](../../.claude/skills/to-issues/SKILL.md) — the same template used for the GitHub issue body — so updating either the local file or the GitHub issue is straightforward.

## Dependency chain

```
01 (scaffold) → 02 (e2e + spike) → 03 (watch UI) → 04 (security) → 05 (multi) → 06 (failure modes) → 07 (CLI + docs) → 08 (release, HITL)
```

| # | Slice | Type | GitHub | Local |
|---|---|---|---|---|
| 1 | Repo scaffold + build pipelines | AFK | [#2](https://github.com/K-Khushal/watchcode/issues/2) | [01](01-scaffold-build-pipelines.md) |
| 2 | End-to-end approval via curl + permissionRules grammar spike | AFK | [#3](https://github.com/K-Khushal/watchcode/issues/3) | [02](02-end-to-end-approval-spike.md) |
| 3 | Watch displays real cards, responds (no security yet) | AFK | [#4](https://github.com/K-Khushal/watchcode/issues/4) | [03](03-watch-cards-no-security.md) |
| 4 | Pairing + HMAC + mDNS | AFK | [#5](https://github.com/K-Khushal/watchcode/issues/5) | [04](04-pairing-hmac-mdns.md) |
| 5 | Multi-session, multi-watch, `.watchcode.json` override | AFK | [#6](https://github.com/K-Khushal/watchcode/issues/6) | [05](05-multi-session-multi-watch.md) |
| 6 | Failure-mode hardening pass | AFK | [#7](https://github.com/K-Khushal/watchcode/issues/7) | [06](06-failure-mode-hardening.md) |
| 7 | Remaining CLI commands + docs | AFK | [#8](https://github.com/K-Khushal/watchcode/issues/8) | [07](07-cli-commands-docs.md) |
| 8 | CI + npm publish + GitHub release | HITL | [#9](https://github.com/K-Khushal/watchcode/issues/9) | [08](08-ci-npm-release.md) |

## Slice-as-tracer-bullet rule

Each slice is a **vertical** cut through the entire stack — schema → daemon → hook/CLI → watch → tests — not a horizontal layer. A completed slice is demoable on its own. The chain above is the order in which slices unblock each other; within a slice, work happens across all layers in parallel.

## How to grab a slice

1. Pick the lowest-numbered slice without an open PR
2. Read the GitHub issue body (or the local file — they're identical)
3. Read the referenced sections of [ARCHITECTURE.md](../ARCHITECTURE.md) and [PRD-watchcode.md](../../PRD-watchcode.md)
4. Open a draft PR titled `slice-NN: <short description>` linking to the issue
5. Tick acceptance-criteria checkboxes as you complete them
6. Mark "ready for review" when all are checked
