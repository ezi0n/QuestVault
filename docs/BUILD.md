# Build & Packaging

## Current Version

Documented application version: `0.8.3`

## Packaging Targets

QuestVault is currently configured to build:

- macOS arm64
- macOS x64
- macOS universal
- Windows x64
- Windows arm64
- Linux x64
- Linux arm64

Configured output formats:

- macOS: `dmg`, `zip`
- Windows: `nsis`, `zip`
- Linux: `AppImage`, `tar.gz`

## Build Commands

Common commands:

```bash
pnpm install
pnpm typecheck
pnpm build
```

Release commands:

```bash
pnpm dist
pnpm dist:mac
pnpm dist:mac:x64
pnpm dist:mac:universal
pnpm dist:win
pnpm dist:win:arm64
pnpm dist:linux
pnpm dist:linux:arm64
```

## Packaging Stack

- app build: `electron-vite`
- desktop runtime: `electron`
- packaging: `electron-builder`

Important build resources:

- icons: `build/icons/`
- build resources root: `build/`
- packaged output: `release/`

## Platform Requirements

### macOS

- Xcode Command Line Tools
- `iconutil` for `.icns` generation when refreshing icons

### Windows

- Windows packaging is handled by `electron-builder`
- NSIS tooling is managed by the builder toolchain

### Linux

- Linux packaging is handled by `electron-builder`
- current targets do not require extra repo-level Linux packaging scripts

## Signing Notes

Local macOS builds in this workspace are produced as unsigned / ad-hoc local builds unless signing credentials are configured externally.

For an unsigned macOS arm64 build, the local pattern is:

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder --mac --arm64 --publish never
```

## Validation Guidance

Recommended validation flow:

1. `pnpm typecheck`
2. `pnpm build`
3. target packaging command(s)

For vrSrc validation, also confirm that the managed dependency bootstrap can prepare a current `rclone` runtime when the bundled/system version is missing or too old, and that vrSrc HTTP transport requests use the pinned `rclone/v1.72.1` user agent.

If packaging fails, classify the issue as one of:

- missing local dependency
- signing / publishing configuration
- unsupported cross-build scenario
- environment / sandbox restriction

## Current Validation Status

Validated in this workspace for `0.8.3` with:

```bash
pnpm typecheck
pnpm build
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder --mac --arm64 --publish never
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder --mac --x64 --publish never
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder --mac --universal --publish never
pnpm exec electron-builder --win --x64 --publish never
pnpm exec electron-builder --win --arm64 --publish never
pnpm exec electron-builder --linux --x64 --publish never
pnpm exec electron-builder --linux --arm64 --publish never
```

Observed outcomes:

- TypeScript validation passed
- Production build passed
- unsigned macOS arm64 packaged build passed
- unsigned macOS x64 packaged build passed
- unsigned macOS universal packaged build passed
- unsigned Windows x64 packaged build passed
- unsigned Windows arm64 packaged build passed
- unsigned Linux x64 packaged build passed
- unsigned Linux arm64 packaged build passed
- v0.6.3-style release asset check passed for `0.8.3`

## Current Icon Set

The active application icon is the rounded vault-door image exported to:

- `build/icons/icon.icns`
- `build/icons/icon.ico`
- `build/icons/icon.png`

## Packaging Notes

- `docs/` are intentionally excluded from packaged output.
- `release/` is the packaging output directory and is ignored by Git.
- `development_only/` is intentionally excluded from tracked repo content.

## Current Non-Blocking Notes

- `electron-builder` can warn that `author` is missing from `package.json`
- local packaging success does not imply notarization, signing, or public release readiness
