# Contributing to WatchCode

Thank you for your interest in WatchCode. This document covers everything needed to get a dev environment running, understand the project structure, and get a change merged.

---

## Table of contents

1. [Prerequisites](#prerequisites)
2. [Cloning and first build](#cloning-and-first-build)
3. [Repository layout](#repository-layout)
4. [Running the daemon locally](#running-the-daemon-locally)
5. [Running tests](#running-tests)
6. [Lint and typecheck](#lint-and-typecheck)
7. [Building the watch APK](#building-the-watch-apk)
8. [Making changes](#making-changes)
9. [Opening a pull request](#opening-a-pull-request)
10. [Code style](#code-style)
11. [Commit conventions](#commit-conventions)
12. [Reporting bugs](#reporting-bugs)

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | ≥ 20 | [nodejs.org](https://nodejs.org) or `nvm install 20` |
| pnpm | ≥ 9 | `npm install -g pnpm` or `corepack enable` |
| Android Studio | Hedgehog or later | Required only for the Wear OS app |
| JDK | 17 | Bundled with Android Studio, or `brew install openjdk@17` |
| ADB | any | Bundled with Android Studio platform-tools |

A Galaxy Watch 6 or a Wear OS 4 emulator is needed to run the watch app end-to-end.

---

## Cloning and first build

```sh
git clone https://github.com/K-Khushal/watchcode.git
cd watchcode
pnpm install       # installs all workspace packages
pnpm -r build      # compiles shared → daemon / hook / cli (in dependency order)
```

`pnpm install` links the four TypeScript packages as workspace dependencies, so changes to `@watchcode/shared` are immediately visible in `daemon`, `hook`, and `cli` without a re-publish step.

---

## Repository layout

```
watchcode/
├── packages/
│   ├── shared/   @watchcode/shared  — Zod schemas + constants, no I/O
│   ├── daemon/   @watchcode/daemon  — long-lived HTTP + WebSocket server
│   ├── hook/     @watchcode/hook    — per-permission subprocess
│   └── cli/      watchcode          — published npm package, commander CLI
├── apps/
│   └── watch/    Wear OS Kotlin app (Gradle)
└── docs/         architecture, protocol, threat model, this file
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full file-level breakdown and module dependency rules.

---

## Running the daemon locally

```sh
# build first if you haven't
pnpm -r build

# start the daemon (it writes a PID file to ~/.watchcode/daemon.pid)
node packages/daemon/dist/index.js

# or use the CLI once packages/cli is wired up
node packages/cli/dist/cli.js start
```

The daemon binds to `127.0.0.1:9876`. You can smoke-test it with:

```sh
curl -s http://127.0.0.1:9876/status | jq .
```

---

## Running tests

```sh
pnpm -r test          # run all vitest suites across every package
pnpm --filter @watchcode/daemon test   # run tests for one package only
```

Tests live alongside source in each package's `test/` directory. Integration tests spin up a real daemon on an ephemeral port — no mocking of the HTTP/WS stack.

---

## Lint and typecheck

```sh
pnpm -r lint          # ESLint across all packages
pnpm -r typecheck     # tsc --noEmit (faster than a full build)
```

Both must pass with zero errors before a PR is ready for review. Warnings from `@typescript-eslint/no-explicit-any` are tolerated in stub files during early slices but should be resolved before the slice is marked done.

---

## Building the watch APK

Open Android Studio and import `apps/watch/`, or build from the terminal:

```sh
cd apps/watch
./gradlew assembleDebug
# Output: app/build/outputs/apk/debug/app-debug.apk
```

To install on a connected watch over ADB Wi-Fi:

```sh
adb connect <watch-ip>:5555
adb install app/build/outputs/apk/debug/app-debug.apk
```

See [watch-install.md](watch-install.md) for step-by-step ADB setup on Galaxy Watch 6.

---

## Making changes

1. **Pick a slice** — choose the lowest-numbered open slice from [docs/issues/README.md](issues/README.md) that has no open PR.
2. **Read the slice file** — acceptance criteria are the definition of done.
3. **Read the architecture** — [ARCHITECTURE.md](ARCHITECTURE.md) defines the module boundaries and forbidden imports. Violations will be caught in review.
4. **Create a branch** — name it `slice-NN/<short-description>` (e.g. `slice-02/approval-spike`).
5. **Work across the full stack** — each slice is a vertical cut; don't leave a layer half-done.
6. **Write tests first** — the test files listed in each slice spec are the primary acceptance signal.

---

## Opening a pull request

- Title: `slice-NN: <short description>` matching the issue title.
- Body: link to the slice issue (`Closes #N`), then paste the acceptance-criteria checklist and tick each box as you complete it.
- Draft PR is fine while work is in progress; switch to "ready for review" only when all criteria are checked and CI is green.
- Keep PRs scoped to one slice. Cross-slice cleanups go in a separate PR with a `chore:` prefix.

---

## Code style

- **TypeScript** — strict mode, ES2022, NodeNext modules. No `any` except where unavoidable; add a comment explaining why.
- **No comments that explain what the code does** — name your identifiers clearly instead. Only add a comment when the *why* is non-obvious (a hidden constraint, a workaround, a subtle invariant).
- **No unused exports** in a finished slice. Stub files during scaffolding may export `{}`.
- **Kotlin** — follow the [Kotlin coding conventions](https://kotlinlang.org/docs/coding-conventions.html). `ktlint` is run in CI.
- **Formatting** — Prettier handles TypeScript/JSON automatically on save if you install the Prettier VS Code extension. For Kotlin, Android Studio's default formatter matches the project style.

---

## Commit conventions

We use [Conventional Commits](https://www.conventionalcommits.org/):

| Prefix | When to use |
|--------|-------------|
| `feat:` | new user-facing feature |
| `fix:` | bug fix |
| `chore:` | build, tooling, deps, no production change |
| `test:` | adding or fixing tests |
| `docs:` | documentation only |
| `refactor:` | restructuring without behaviour change |

Examples:

```
feat(daemon): enqueue approval requests and broadcast to watches
fix(hook): exit silent when transcript grows before long-poll resolves
chore: scaffold monorepo and wear os module
```

Scope (in parentheses) is the package name — `shared`, `daemon`, `hook`, `cli`, or `watch`. Omit scope for repo-wide changes.

---

## Reporting bugs

Open an issue at [github.com/K-Khushal/watchcode/issues](https://github.com/K-Khushal/watchcode/issues). Include:

- WatchCode version (`watchcode --version`)
- macOS version and Node version (`node -v`)
- Watch model and Wear OS version
- Steps to reproduce
- Actual vs expected behaviour
- Relevant lines from `~/.watchcode/logs/daemon-YYYY-MM-DD.log`
