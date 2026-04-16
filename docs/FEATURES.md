# Features

## Core Workspaces

### Apps & Games

- Local Library browser with grid and list views.
- Integrated vrSrc remote source toggle inside the same workspace.
- Search-first workflow across local items, backup-storage entries, and metadata-enriched titles.
- Version-family handling that collapses duplicate packages during browsing and expands matches during search.
- Local detail drawer with install, metadata, version, and cleanup actions.

### Installed Inventory

- Headset-installed app browser with grid/list views.
- Summary row for user-installed apps, system apps, total storage, storage free, and orphaned data.
- Installed item actions for backup and uninstall.

### Game Saves

- Save backup discovery for installed headset titles.
- Backup-only history visibility.
- Snapshot backup, restore, and delete flows.
- Save item detail drawer / support workflows where applicable.

### ADB Manager

- Managed runtime visibility.
- Wi-Fi pairing.
- Connected headset overview with serial, HorizonOS, storage, and live device pills.
- Managed/runtime status cards and refresh actions.

### Settings

- Storage and index metrics.
- Managed dependency summary + popup.
- Library diagnostics summary + popup.
- Orphaned data summary + popup.
- Path configuration for Local Library, Backup Storage, and Game Saves.

## Cross-Cutting UX Features

- Shared Live queue for scans, installs, downloads, dependency setup, backups, deletes, and failures.
- Shared drawer pattern for item detail interaction.
- Shared close-pill language across support dialogs and drawers.
- Support popups for maintenance tasks instead of large always-inline sections.
- Current icon system aligned across macOS, Windows, and Linux packaging assets.

## vrSrc-Specific Features

- Sync Source controls inside Apps & Games.
- Remote list + grid modes.
- Remote status filters (`New`, `Updates`).
- Remote notes and trailer embedding in the vrSrc drawer.
- Add-to-library and install-now actions.
- Managed dependency support for extraction tooling.

## Maintenance Features

- Library diagnostics for raw index review.
- Managed dependency readiness inspection for ADB and 7-Zip.
- Orphaned OBB / Data inspection and cleanup.
- Missing-item review surfaces.
- Manual metadata save/override support.

## Packaging Status

QuestVault is currently configured for:

- macOS arm64 / x64 / universal
- Windows x64 / arm64
- Linux x64 / arm64

Current documented release line: `0.4.2`

## Product Position

QuestVault currently functions as:

- a Quest content library manager
- a headset inventory browser
- a save backup and restore tool
- an ADB/runtime operations surface
- a vrSrc-assisted remote acquisition surface
- a maintenance and diagnostics console for local + device-side cleanup
