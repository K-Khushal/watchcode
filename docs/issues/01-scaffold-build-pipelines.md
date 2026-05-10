# Slice 1 — Repo scaffold + build pipelines

**Type:** AFK  
**GitHub:** [K-Khushal/watchcode#2](https://github.com/K-Khushal/watchcode/issues/2)  
**Status:** ready-for-agent

---

## Parent

#1

## What to build

Set up the empty `pnpm` monorepo plus the Wear OS Gradle module so subsequent slices have a working build pipeline. No runtime functionality — just the skeleton matching `docs/ARCHITECTURE.md` §1.

Layout:
- `pnpm-workspace.yaml` covering `packages/*` (skip `apps/watch` — Gradle owns it)
- Four TypeScript packages — `@watchcode/shared`, `@watchcode/daemon`, `@watchcode/hook`, `@watchcode/cli` — each with its own `package.json`, `tsconfig.json` (composite, extends `tsconfig.base.json`), and an empty `src/index.ts`
- Strict TS config (ES2022, NodeNext), shared lint (eslint) and format (prettier)
- `apps/watch/` Gradle skeleton from "Wear OS Empty App" template; min SDK 30, target SDK 34; default activity prints "Hello WatchCode"
- `LICENSE` (MIT), placeholder `README.md`
- `docs/` directory pre-seeded with empty `protocol.md`, `threat-model.md`, `watch-install.md`, `CONTRIBUTING.md` files (the existing `ARCHITECTURE.md` and `BUILD-PLAN.md` stay untouched)
- `.gitignore` covers `node_modules/`, `dist/`, `.gradle/`, `build/`, `*.apk`, `*.keystore`
- `.npmrc` with `link-workspace-packages=true`, `save-exact=true`

## Acceptance criteria

- [ ] `pnpm install` succeeds with no warnings
- [ ] `pnpm -r build` produces `dist/` in every package
- [ ] `pnpm -r lint` and `pnpm -r typecheck` pass with empty `src/index.ts` files
- [ ] `cd apps/watch && ./gradlew assembleDebug` produces a debug APK
- [ ] APK installs on a Galaxy Watch 6 (or Wear OS 4 emulator) and shows "Hello WatchCode"
- [ ] Repository tree matches `docs/ARCHITECTURE.md` §1 layout (file list, not contents)
- [ ] Initial commit message: `chore: scaffold monorepo and wear os module`

## Blocked by

None — can start immediately.
