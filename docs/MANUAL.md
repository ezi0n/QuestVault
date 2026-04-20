# User Manual

Current documented application version: `0.5.7`

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

- `0%` = 6 cards per row
- `50%` = 5 cards per row
- `100%` = 4 cards per row

### Local item drawer

Selecting a local item opens a right-side drawer where you can inspect:

- package ID
- versions
- install state
- store ID
- artwork and description
- older local versions

If older versions exist, choose a specific older version and delete it with confirmation.

## vrSrc

Enable vrSrc from the hero pill in `Apps & Games`.

The current vrSrc flow lets you:

- sync the protected remote catalog
- compare remote items with the Local Library
- browse remote items in grid or list mode
- add items to the Local Library
- install items directly to the headset

Selecting a vrSrc item opens a remote detail drawer that can include:

- remote/library version comparison
- notes
- trailer embed
- release details

## Installed Inventory

Use `Installed Inventory` to review what is currently on the headset.

You can:

- browse installed apps in grid or list mode
- open an installed-app detail drawer from either layout
- back up installed APKs
- uninstall installed apps
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
