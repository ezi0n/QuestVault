# User Manual

Current documented application version: `0.6.2`

## Overview

QuestVault helps you manage Quest content across five main areas:

- `Apps & Games`
- `Installed Inventory`
- `Game Saves`
- `ADB Manager`
- `Settings`

## Apps & Games

Use `Apps & Games` for local library browsing, metadata review, install decisions, and vrSrc access.

You can:

- search the Local Library
- browse in `Grid View` or `List View`
- review Local Library status/catalog/new/update summary pills
- review duplicate package families
- install/update local items
- open the vrSrc remote source panel

### Search

The search field matches:

- title
- package ID
- release name
- normalized spaced/unspaced variants

### Grid density

In grid mode, the scale control currently uses three fixed stops:

- `1.0x` = 4 cards per row
- `1.25x` = 5 cards per row
- `1.5x` = 6 cards per row

### Local item drawer

Selecting a local item opens a right-side drawer where you can inspect:

- package ID
- versions
- install state
- store ID
- storefront rating when available
- supported devices, comfort, and player-mode metadata when available
- artwork and description
- older local versions

If older versions exist, choose a specific older version and delete it with confirmation.

For install, uninstall, and delete actions, the drawer now closes immediately so the resulting work is visible in `Live`. Metadata and artwork extraction flows stay in the drawer.

When artwork links fail or a metadata source has no usable image, QuestVault now falls back to generated artwork surfaces instead of leaving the card or drawer blank.

### Local Library list dates

In `List View`, the Local Library includes a `Date` column.

- primary source: retained Local Library source date
- fallback source: matched vrSrc `lastUpdated` date when available
- format: `DD-MM-YYYY`
- sort modes: `Title` and `Date`

## vrSrc

Enable vrSrc from the hero pill in `Apps & Games`.

The current vrSrc flow lets you:

- sync the protected remote catalog
- compare remote items with the Local Library
- browse remote items in grid or list mode
- add items to the Local Library
- install items directly to the headset

For download, update, and install actions, the vrSrc drawer now closes immediately so the transfer or install state is visible in `Live` right away. If the selected payload is already in the Local Library or cannot proceed, those outcomes are also surfaced through `Live` instead of only inline workspace banners.

On Windows, vrSrc sync now prefers IPv4 for remote requests. This helps avoid Cloudflare `403 Forbidden` responses that were observed on some IPv6 request paths.

Selecting a vrSrc item opens a remote detail drawer that can include:

- remote version and version code
- footprint and updated date
- notes
- trailer embed
- release details

If a matching local payload already covers the selected vrSrc release, the drawer now routes the outcome through `Live` instead of relying only on inline drawer messaging.

## Installed Inventory

Use `Installed Inventory` to review what is currently on the headset.

You can:

- browse installed apps in grid or list mode
- open an installed-app detail drawer from either layout
- back up installed APKs
- uninstall installed apps
- review storefront rating, trailer, genres, comfort, game modes, player modes, and supported devices when metadata exists
- review summary metrics for:
  - user installed apps
  - system apps
  - total storage
  - storage free
  - orphaned data

## Game Saves

Use `Game Saves` to manage headset save data history.

You can:

- scan save-capable packages on the headset
- create save snapshots
- restore snapshots
- delete outdated snapshots
- review installed save targets and backup-only history together

From a save drawer, `Scan headset saves` now scans only the selected title. The toolbar `Scan headset saves` action remains the full-headset scan.

Save drawer action buttons such as `Scan headset saves` and `Back Up Current Save` now close the drawer first and reveal the `Live` drawer, matching the Local Library and vrSrc action flow.

## ADB Manager

Use `ADB Manager` for:

- Wi-Fi pairing
- managed ADB visibility
- runtime status
- connected headset review
- device serial / HorizonOS / transport / battery details

## Settings

Use `Settings, and maintenance` for:

- Local Library path configuration
- Backup Storage path configuration
- Game Saves path configuration
- library/storage metrics
- dependency inspection
- diagnostics
- orphaned-data review
- headset app scan history across recent installed-app refreshes

### Managed Dependencies

Open the `Managed Dependencies` popup to inspect:

- Managed ADB
- 7-Zip
- current source (`Managed` or `System`)
- resolved binary path
- readiness state

### Library Diagnostics

Open `Library Diagnostics` to inspect raw index data, review missing items, and run supported cleanup/purge actions.

### Orphaned OBB / Data

Open `Orphaned OBB / Data` to:

- scan headset leftovers
- inspect orphaned paths
- delete leftover data from apps that are no longer installed

### Headset App Scan History

The `Maintenance` section includes a compact chart showing:

- apps present on the headset at each recent scan
- apps removed since the previous scan

Use `Refresh installed apps` in `Installed Inventory` to add new scan points to this history.

Installed-app metadata refresh now starts from the persisted installed metadata index. Repeat refreshes reuse known matches, remove packages that are no longer installed, and only hydrate packages that are still missing metadata. The installed list becomes usable as soon as the scan finishes, while the remaining metadata work continues in the background and reports progress in `Live`.

## Live Queue

The `Live` drawer is the main source of truth for long-running operations such as:

- library rescans
- inventory refresh
- installs
- save backups/restores
- vrSrc downloads
- dependency setup
- failures and recovery states

Success-only inline banners have been reduced in several areas in favor of Live.

Installed-app refreshes are also deferred slightly after install and uninstall bursts so repeated device mutations do not flood Live with redundant refreshes.
