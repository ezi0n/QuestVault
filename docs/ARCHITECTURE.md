# Architecture

## Overview

QuestVault is an Electron desktop application for Quest library management, installed-app review, save backup workflows, ADB operations, and vrSrc-assisted remote catalog access. The app uses a typed split between the Electron main process, a preload bridge, and a React renderer.

Current documented application version: `0.8.0`

## Runtime Shape

- `src/main/`
  Electron main process, IPC handlers, packaging entrypoint, and operational services.
- `src/preload/`
  Typed bridge that exposes approved main-process APIs to the renderer.
- `src/renderer/`
  React UI, workspace shells, dialogs, drawers, and state-driven workflows.
- `src/shared/`
  Shared IPC/domain types used across process boundaries.

## Main Process Responsibilities

### Dependency bootstrap

QuestVault now manages required runtime tooling through a dedicated dependency layer.

- Ensures a usable ADB runtime exists.
- Resolves or prepares a usable `7z` / `7zz` runtime for vrSrc extraction.
- Resolves or prepares a usable `rclone` runtime for vrSrc transfer operations.
- Prefers system tooling when available and falls back to managed copies when required.
- Reports dependency progress and failures into the renderer so startup/setup work can surface in Live.

### Device operations

The device service is responsible for headset-facing operations:

- enumerate connected devices
- enrich device summaries with serial, storage, and HorizonOS details
- scan installed packages
- classify user-installed and system packages
- persist installed-app scan snapshots and compute scan deltas/history for maintenance reporting
- uninstall installed apps
- back up installed APKs
- inspect leftover data under `/sdcard/Android/data` and `/sdcard/Android/obb`
- write headset action records for connect, install, uninstall, APK install, and OBB transfer progress/failures

Folder install flows prefer the package ID already stored in the local library index when choosing the OBB destination directory. Filename-based OBB package inference remains a fallback for entries without indexed package metadata.

### Local indexing and storage management

The settings and indexing services own:

- Local Library indexing
- Backup Storage indexing
- Game Saves path configuration
- filesystem watcher updates
- missing-entry tracking
- stale index cleanup
- manual metadata/store-id override support
- source-date retention for Local Library items so remote update dates can be surfaced and sorted in Local Library views

The local library index persists the app’s install-ready truth, while metadata enrichment remains additive.

### Metadata enrichment

Meta metadata is cached separately and layered onto local and installed items. It can improve:

- names
- artwork
- descriptions
- categories
- storefront rating
- supported devices
- game modes / player modes
- comfort level
- trailer reuse across workspaces
- store matching
- version comparison context

It does not replace filesystem truth or device truth.

### Save workflows

The savegame service manages:

- save-capable package discovery
- headset save scans
- snapshot creation into the configured Game Saves path
- snapshot restore
- snapshot delete

### vrSrc integration

The vrSrc service handles:

- remote source sync
- source credential/server resolution
- metadata archive download + extraction
- remote release lookup
- remote item download/resume
- add-to-library handoff
- install-now handoff
- staged download cleanup

It also supports richer on-demand item details such as notes and trailer lookup for the vrSrc drawer.

Credential resolution still uses `curl` against Telegram, but vrSrc metadata archive and payload transfers now use `rclone`. QuestVault pins vrSrc HTTP transport requests to the `rclone/v1.72.1` user agent. Managed/system `rclone` versions are checked against a minimum working version so older QuestVault-managed runtimes can be replaced automatically during upgrades.

On Windows, vrSrc network requests still prefer IPv4 when spawning `curl`, which helps avoid Cloudflare rejections seen on some IPv6 request paths.

Catalog rows whose parsed footprint is non-positive are filtered during sync and again when reading older cached catalogs, keeping placeholder `0 MB` rows out of source counts, result lists, and download actions.

## Renderer Architecture

The renderer is centered around `App.tsx` and `WireframeShell.tsx`.

- `App.tsx`
  Owns startup orchestration, state, subscriptions, Live queue coordination, dialogs, and long-running action handlers.
- `WireframeShell.tsx`
  Renders the main shell, workspaces, support popups, shared drawers, and workspace-specific toolbars.

The renderer now also coalesces installed-app refreshes after mutation-heavy flows and uses resilient artwork fallbacks so failed remote images do not collapse core UI surfaces.

Installed-app metadata refresh now starts from the persisted installed metadata index, filters it to the currently scanned packages, and only hydrates packages that are still missing matches. This keeps repeat refreshes accurate without paying the cost of fully re-enriching every installed package on every scan.

Alias-shaped package IDs, including MR-Fix style package variants, are treated as candidates for richer storefront matches. Cached exact package stubs no longer automatically outrank remote matches that provide artwork, store IDs, or richer metadata.

Drawer action handoff is now more uniform across workspaces: Local Library, vrSrc, and Game Saves close their detail drawers before long-running install, download, scan, or backup flows so the Live queue becomes the single visible progress surface.

Live can also surface a recent Headset Activity panel when a new headset operation fails. The renderer reads recent NDJSON headset action records through the preload bridge, ignores historical failures during startup, and opens the panel only for newly observed failed records.

The shared drawer CSS now also includes stronger overflow guards for vrSrc content blocks, especially around title rows, trailer headers, and long note/body strings that can include patch paths or JSON-like keys.

Apps & Games keeps update filtering centralized in the global filter row. The vrSrc header `Updates` pill is a display-only remote update count, while the global `Updates` filter applies consistently across the active Local Library and vrSrc views. The Local Library `New` summary pill is a local-only filter for recent library additions.

Opening the vrSrc panel clears Local Library-only recent-addition filtering so the remote catalog starts from an unfiltered result set.

## Primary Workspaces

- `Apps & Games`
- `Installed Inventory`
- `Game Saves`
- `ADB Manager`
- `Settings`

Each workspace uses a shared visual shell, but their content surfaces differ:

- `Apps & Games`
  Fixed hero + fixed search/action bar + inner scroll region.
- `Installed Inventory`
  Fixed hero + summary row + inventory surface with grid/list modes.
- `Game Saves`
  Fixed hero + save workflow toolbar + save target gallery/list.
- `ADB Manager`
  Device/runtime operations workspace with network pairing, live devices, and runtime visibility.
- `Settings`
  Storage insights, diagnostics, dependency tooling, maintenance entry points, and a compact headset app scan history view.

## Support Surfaces

QuestVault now exposes several support popups/drawers instead of forcing everything inline:

- `Library Diagnostics`
- `Managed Dependencies`
- `Orphaned OBB / Data`
- item detail drawers
- Live queue drawer

Installed Inventory now uses the same portaled right-side drawer layer as the other content views so its details surface overlays the workspace consistently instead of rendering inside the inventory panel tree.

This keeps maintenance tools accessible without permanently occupying the main workspace layout.

## Data Truth Model

QuestVault treats data sources separately:

- device truth
  Installed app data comes from headset scans.
- local library truth
  Install-ready content comes from indexed Local Library entries.
- backup truth
  Backup Storage remains distinct from Local Library even when package IDs overlap.
- remote truth
  vrSrc represents a separate remote source with its own sync/download workflow.
- metadata enrichment
  Meta metadata enhances presentation and comparison, but does not override the above sources.

## Version Family Handling

`Apps & Games` uses family-aware package handling:

- duplicate package families are grouped by package ID first
- browsing collapses to the newest visible representative
- active search can reveal matching variants
- older local versions are selectable in the drawer and can be deleted one at a time with confirmation
- vrSrc-style `v<code>+<name>` release names can also seed local-library version fallback data when manifest metadata is incomplete

## Event Flow

- startup loads settings, cached indexes, device state, and metadata in parallel where possible
- dependency preparation can run on startup and report progress to Live
- filesystem watchers emit library/storage refresh events into the renderer
- Live tracks scans, installs, backups, deletes, metadata work, vrSrc transfers, and dependency setup

## Persistence

QuestVault persists:

- application settings
- local library index
- backup storage index
- metadata cache
- save snapshots
- managed dependency state
- selected renderer preferences such as grid/list choices

The current product model favors cached startup plus background refresh so the app becomes usable quickly and then refines itself as device/index work finishes.
