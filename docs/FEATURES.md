# Features

## Core Workspaces

### Apps & Games

- Local Library browser with grid and list views.
- Integrated vrSrc remote source toggle inside the same workspace.
- Search-first workflow across local items, backup-storage entries, and metadata-enriched titles.
- Version-family handling that collapses duplicate packages during browsing and expands matches during search.
- Local detail drawer with install, metadata, version, and cleanup actions.
- Local Library summary pills for status, catalog size, recent additions, update count, and title/date sorting.
- Local Library list view date column with vrSrc-backed fallback dates for chronological sorting.

### Installed Inventory

- Headset-installed app browser with grid/list views.
- Summary row for user-installed apps, system apps, total storage, storage free, and orphaned data.
- Right-side installed-app detail drawer from both grid and list selections.
- Installed item actions for backup and uninstall.
- Installed-app scan history that feeds maintenance-side headset app history charts.

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
- Compact headset app scan history chart for the last recent scans in Maintenance.

## Cross-Cutting UX Features

- Shared Live queue for scans, installs, downloads, dependency setup, backups, deletes, and failures.
- Startup GitHub release check surfaced through Live, with direct release-link action when an update is available.
- Shared drawer pattern for item detail interaction.
- Local detail drawers auto-close into Live for install/uninstall/delete actions while keeping extraction and metadata flows visible in-place.
- Shared close-pill language across support dialogs and drawers.
- Support popups for maintenance tasks instead of large always-inline sections.
- Current icon system aligned across macOS, Windows, and Linux packaging assets.
- Signature-mismatch install recovery now uses an in-app guarded confirmation dialog instead of a simple native OK/Cancel prompt.

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

Current documented release line: `0.5.9`

## Product Position

QuestVault currently functions as:

- a Quest content library manager
- a headset inventory browser
- a save backup and restore tool
- an ADB/runtime operations surface
- a vrSrc-assisted remote acquisition surface
- a maintenance and diagnostics console for local + device-side cleanup
