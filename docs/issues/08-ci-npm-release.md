# Slice 8 — CI + npm publish + GitHub release (HITL smoke test)

**Type:** HITL  
**GitHub:** [K-Khushal/watchcode#9](https://github.com/K-Khushal/watchcode/issues/9)  
**Status:** ready-for-agent

---

## Parent

#1

## What to build

Ship v1.0.0. CI catches regressions on every push; the bundle is published to npm; the watch APK is downloadable from a GitHub release; a clean-machine smoke test passes on macOS and Windows.

This slice is **HITL** — the smoke test on clean VMs requires human verification and judgment.

## Scope

- **GitHub Actions — Node CI**: matrix Node 20 + Node 22 × ubuntu-latest + macos-latest + windows-latest. Steps: `pnpm install --frozen-lockfile`, `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test`, `pnpm -r build`. Triggered on push to `main` and on PRs.
- **GitHub Actions — Android CI**: ubuntu-latest with JDK 17 + Android SDK. Steps: `cd apps/watch && ./gradlew assembleDebug`. Triggered on push and PRs that touch `apps/watch/**`.
- **npm bundle**: the published `watchcode` package contains a single binary built via esbuild that inlines the workspace dependencies (`@watchcode/shared`, `@watchcode/daemon`, `@watchcode/hook`, `@watchcode/cli`). Verify via `npm pack` that no `node_modules` or test files leak. The package's `bin` entry points to the bundled CLI.
- **Watch APK**: `cd apps/watch && ./gradlew assembleRelease` (or `assembleDebug` if release signing is out of scope) produces a signed APK. Attach the APK to the GitHub release as `watchcode-watch-v1.0.0.apk`.
- **`watchcode pair` integration**: the printed help text after pairing includes the APK download URL pattern (`https://github.com/K-Khushal/watchcode/releases/latest/download/watchcode-watch.apk`).
- **Smoke test (HITL)**: on a clean macOS VM and a clean Windows VM, run `npm install -g watchcode@1.0.0-rc1` → `watchcode start` → `watchcode pair` → install APK on a real Galaxy Watch 6 → complete pairing → run `claude` in a fresh repo → request a Bash command → approve from the watch → verify Claude proceeds. Repeat with deny and respond-at-PC. Both VMs and both flows must pass.
- **Tag and release**: after smoke tests pass, tag `v1.0.0`, run `npm publish`, attach the final APK to the GitHub release. Update the README's "Latest release" badge if used.

## Acceptance criteria

- [ ] Node CI matrix is green on a fresh PR (Node 20 + 22, three OSes)
- [ ] Android CI is green on a fresh PR
- [ ] `npm pack` output is small (< a few MB) and contains only the bundled CLI + manifest + LICENSE + README — no source, no tests, no `node_modules`
- [ ] Pre-release: `npm publish --tag rc` of `1.0.0-rc1` works; `npm install -g watchcode@1.0.0-rc1` on a fresh machine makes `watchcode` available on `$PATH`
- [ ] Signed (or debug-signed) APK is attached to the `v1.0.0-rc1` GitHub release
- [ ] **Smoke test on clean macOS VM** (HITL): the full Approve / Deny / respond-at-PC flow passes end-to-end in <5 minutes from `npm install -g`
- [ ] **Smoke test on clean Windows VM** (HITL): same as above
- [ ] After smoke tests pass: tag `v1.0.0`, `npm publish` (no `--tag rc`), final APK attached to the `v1.0.0` GitHub release

## Blocked by

#8

