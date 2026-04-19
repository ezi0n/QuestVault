# Build & Packaging

## Current Version

Documented application version: `0.5.3`

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

If packaging fails, classify the issue as one of:

- missing local dependency
- signing / publishing configuration
- unsupported cross-build scenario
- environment / sandbox restriction

## Current Validation Status

Validated in this workspace during the current `0.4.x` line with:

```bash
pnpm typecheck
pnpm build
pnpm exec electron-builder --mac --arm64 --dir --publish never
pnpm exec electron-builder --win --x64 --dir --publish never
pnpm exec electron-builder --linux --x64 --dir --publish never
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder --mac --arm64 --publish never
```

Observed outcomes:

- TypeScript validation passed
- Production build passed
- macOS unpacked packaging passed
- Windows unpacked packaging passed
- Linux unpacked packaging passed
- unsigned macOS arm64 packaged build passed

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
