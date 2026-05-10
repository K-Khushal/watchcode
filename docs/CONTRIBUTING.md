# Contributing to WatchCode

Thank you for your interest in WatchCode. This document walks you through everything from a clean machine to a running emulator, then covers how to make and submit changes.

---

## Table of contents

1. [Prerequisites](#prerequisites)
2. [Cloning and first build](#cloning-and-first-build)
3. [Repository layout](#repository-layout)
4. [Android Studio setup](#android-studio-setup)
5. [Shell environment variables](#shell-environment-variables)
6. [Creating a Wear OS emulator](#creating-a-wear-os-emulator)
7. [Building and running the watch app](#building-and-running-the-watch-app)
8. [Running the daemon locally](#running-the-daemon-locally)
9. [Running tests](#running-tests)
10. [Lint and typecheck](#lint-and-typecheck)
11. [Making changes](#making-changes)
12. [Opening a pull request](#opening-a-pull-request)
13. [Code style](#code-style)
14. [Commit conventions](#commit-conventions)
15. [Reporting bugs](#reporting-bugs)

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | ≥ 20 | [nodejs.org](https://nodejs.org) or `nvm install 20` |
| pnpm | ≥ 9 | `npm install -g pnpm` |
| Android Studio | Hedgehog or later | Required for the Wear OS app — bundles JDK and ADB |

> **JDK and ADB** are bundled inside Android Studio. You do not need to install them separately — the shell setup in step 5 points your terminal at the bundled copies.

---

## Cloning and first build

```sh
git clone https://github.com/K-Khushal/watchcode.git
cd watchcode
pnpm install       # installs all workspace packages and links them
pnpm -r build      # compiles shared → daemon / hook / cli in dependency order
```

Verify the build produced output:

```sh
ls packages/shared/dist    # index.js, index.d.ts, ...
ls packages/daemon/dist
ls packages/hook/dist
ls packages/cli/dist
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

## Android Studio setup

1. Download **Android Studio** (Hedgehog or later) from [developer.android.com/studio](https://developer.android.com/studio). Pick the **Apple Silicon** `.dmg` if you are on an M-series Mac.

2. Open the `.dmg`, drag Android Studio to `/Applications`, and launch it.

3. The **Setup Wizard** runs on first launch. Choose **Standard** install, accept all SDK licenses, and let it download the SDK and platform tools (~5–10 min).

4. When the wizard finishes, open **More Actions → SDK Manager** and confirm the following are installed:

   - **SDK Platforms** tab → **Android 14.0 (API 34)** ✓
   - **SDK Tools** tab → **Android SDK Build-Tools 34**, **Android SDK Platform-Tools** ✓

---

## Shell environment variables

Android Studio installs the SDK to `~/Library/Android/sdk` and bundles its own JDK. Add both to your shell so that `adb`, `java`, and Gradle all work from the terminal.

Open `~/.zshrc` in any editor and add these lines near the top, **before** any other `PATH` exports:

```sh
# Android SDK
export ANDROID_HOME="$HOME/Library/Android/sdk"
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
```

Save the file, then reload it in every open terminal:

```sh
source ~/.zshrc
```

Verify both tools are found:

```sh
java -version   # should print OpenJDK 21.x
adb version     # should print Android Debug Bridge version 1.0.x
```

---

## Creating a Wear OS emulator

> Skip this section if you have a physical Galaxy Watch 6 (or any Wear OS 4+ device) — you can use ADB over Wi-Fi instead (see [watch-install.md](watch-install.md)).

1. In Android Studio, open **More Actions → Device Manager → Create Virtual Device**.
2. Click **New Hardware Profile** or pick an existing Wear OS profile (e.g. **Wear OS Small Round**). Click **Next**.
3. On the **System Image** step, select the **Wear OS** tab and download/select:
   - **Wear OS 5 — ARM 64 v8a** (API 34) — matches our `targetSdk 34`
4. Click **Finish**, then click the **▶ Play** button next to the new device to start it.
5. Wait for the emulator to fully boot (the watch face appears).

Confirm ADB sees it:

```sh
adb devices
# emulator-5554   device
```

---

## Building and running the watch app

### Build the APK

```sh
cd apps/watch
./gradlew assembleDebug
```

First run downloads Gradle (~2 min) and SDK dependencies. Subsequent builds take a few seconds. The APK lands at:

```
apps/watch/app/build/outputs/apk/debug/app-debug.apk
```

### Install on the emulator

```sh
adb -s emulator-5554 install -r apps/watch/app/build/outputs/apk/debug/app-debug.apk
# Performing Streamed Install
# Success
```

### Launch the app

```sh
adb -s emulator-5554 shell am start -n com.watchcode/.MainActivity
```

You should see **"Hello WatchCode"** centered on the watch face.

### Install on a physical watch (optional)

Enable ADB over Wi-Fi on the watch (**Settings → Developer options → Wireless debugging**), note the IP, then:

```sh
adb connect <watch-ip>:5555
adb install apps/watch/app/build/outputs/apk/debug/app-debug.apk
```

See [watch-install.md](watch-install.md) for detailed step-by-step instructions.

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

The daemon binds to `127.0.0.1:9876`. Smoke-test it with:

```sh
curl -s http://127.0.0.1:9876/status | jq .
```

---

## Running tests

```sh
pnpm -r test                                # all packages
pnpm --filter @watchcode/daemon test        # one package only
```

Tests live in each package's `test/` directory. Integration tests spin up a real daemon on an ephemeral port — no mocking of the HTTP/WS stack.

---

## Lint and typecheck

```sh
pnpm -r lint          # ESLint across all packages
pnpm -r typecheck     # tsc --noEmit (faster than a full build)
```

Both must pass with zero errors before a PR is ready for review.

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
