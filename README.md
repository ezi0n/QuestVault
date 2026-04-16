<p align="center">
  <img width="512" height="512" alt="QuestVault icon" src="screenshots/512x512.png" />
</p>

# QuestVault

QuestVault is a desktop Quest content manager for local library indexing, headset inventory, save backup workflows, ADB operations, and vrSrc-assisted remote catalog downloads.

## Inspiration

This project is heavily inspired by the fantastic work done on [Rookie Sideloader](https://github.com/VRPirates/rookie), ApprenticeVR, and ApprenticeVR vrSrc Edition.

## Core Areas

### Apps & Games

- Local library catalog with gallery and list layouts.
- Search-first workflow across local payloads, backup payloads, and metadata-enriched titles.
- Version-aware duplicate handling:
  - latest version shown during normal browsing
  - full matching variants visible during search
  - older local versions removable from the latest version's detail drawer
- Manual install entry points for APK files and folders.
- One-click metadata refresh for indexed titles.
- Detail drawer with artwork, description, category chips, versions, package ID, store ID, folder name, and install actions.

### Installed Inventory

- Headset-installed apps and games inventory.
- Independent grid/list display preference persistence.
- Installed-state actions such as uninstall and backup.

### ADB Manager

- Managed ADB readiness surface.
- USB/Wi-Fi connection support.
- Connected device overview with storage and installed-app count.
- Device-centric operational feedback through the Live Queue.

### Game Saves

- Live save scan of the selected headset.
- Save backup creation.
- Save restore from stored snapshots.
- Save backup deletion.
- Combined visibility for installed save targets and backup-only history.

### Settings

- Path configuration for Local Library, Backup Storage, and Game Saves.
- Index totals and storage statistics.
- Local library rescan and review tools.
- Backup-storage maintenance actions.
- Leftover-data scan for device cleanup decisions.

## User Experience Features

- Shared Live Queue for operational transparency.
- Metadata-enriched artwork and descriptions where available.
- Manual metadata override tools for local entries that lack clean store matches.
- Background refresh patterns that keep the app usable while scans and enrichment continue.
- Watcher-driven updates when indexed folders change on disk.

- [QuestVault Screenshots](screenshots/)

## Packaging and Platform Status

- Electron desktop app.
- Current build targets configured for:
  - macOS
  - Windows
  - Linux

## Current Product Position

QuestVault currently functions as:

- a Quest device operations console
- a local archive and install manager
- a backup-storage organizer
- a save-state backup and restore tool
- a metadata-enriched review layer over local and headset content

## Development

The app uses Electron 36 + React 19 + TypeScript at its core.

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm build
```

## Packaging

Build targets are configured for:

- macOS (`dmg`, `zip`)
- Windows (`nsis`, `zip`)
- Linux (`AppImage`, `tar.gz`)

Active build icon assets live under `build/icons/`.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Capabilities](docs/CAPABILITIES.md)
- [Features](docs/FEATURES.md)
- [Build & Packaging](docs/BUILD.md)
- [User Manual](docs/MANUAL.md)
