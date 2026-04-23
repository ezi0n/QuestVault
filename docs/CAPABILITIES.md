# Capabilities

## Device Management

- Detect connected Quest headsets over USB and ADB-over-Wi-Fi.
- Surface device serial, storage, HorizonOS, battery, transport, and live IP details.
- Manage a prepared ADB runtime and expose dependency readiness in Settings and Live.
- Pair devices over Wi-Fi from the ADB Manager workspace.
- Track runtime/device changes through the Live queue and runtime surfaces.

## Apps & Games

- Index Local Library content from APKs, folders, archives, and install-ready payloads.
- Index Backup Storage separately from the main library.
- Search titles, package IDs, release names, versions, and normalized name variants.
- Browse in grid or list mode.
- Change gallery density through the grid scale control.
- Install or update local content onto the headset.
- Open a rich local item drawer with:
  - artwork
  - descriptions
  - storefront rating
  - supported devices / comfort / player modes when available
  - package ID
  - version information
  - store ID
  - older-version cleanup controls
- Refresh metadata and apply manual metadata/store-id corrections.
- Review hidden version families and delete a selected older version with confirmation.

## vrSrc Remote Source

- Sync the protected remote catalog.
- Compare remote releases against the current local library.
- Browse vrSrc in grid or list mode inside the Apps & Games workspace.
- Add remote releases into the Local Library.
- Install remote releases directly to the connected headset.
- Resume interrupted remote downloads where possible.
- Clean up staged downloads after successful handoff.
- Prefer IPv4 on Windows for vrSrc remote requests when Cloudflare blocks the IPv6 path.
- Hand remote drawer actions off to the Live queue for download/update/install visibility and blocked outcomes.
- View a remote detail drawer with:
  - artwork
  - remote version / version code / release metadata
  - release metadata
  - notes
  - trailer embed when available

## Installed Inventory

- Scan installed headset applications.
- Distinguish user-installed counts from system package counts.
- Show installed inventory in grid or list mode.
- Record installed-app scan snapshots for recent-history comparison.
- Back up installed APKs.
- Uninstall installed apps.
- Review storage and leftover-data summary metrics above the inventory surface.
- Reuse cached installed metadata matches on repeat refreshes and only hydrate packages that are still missing metadata after the scan.

## Game Saves

- Scan save-capable headset packages.
- Scan only the selected title from the save drawer while keeping the toolbar scan as the full-headset save scan.
- Surface installed save targets and backup-only history in one workspace.
- Create save snapshots from the headset.
- Restore snapshots back to the headset.
- Delete save snapshots.
- Browse saves in grid or list mode with status-aware cards.
- Wrap long package identifiers cleanly in the save drawer instead of overflowing horizontally.
- Review save drawers with storefront rating, trailer, descriptions, comfort level, game modes, supported player modes, and supported devices when a metadata match exists.

## Settings and Maintenance

- Configure Local Library, Backup Storage, and Game Saves paths.
- Rescan indexed paths.
- Review storage totals and content metrics.
- Review headset app scan history for apps present versus removed across recent scans.
- Open `Library Diagnostics` for raw index inspection and cleanup.
- Open `Managed Dependencies` to inspect ADB / 7-Zip readiness.
- Open `Orphaned OBB / Data` to inspect leftover headset storage.
- Move or purge stale indexed content where supported.

## Diagnostics and Support

- Review missing indexed items.
- Inspect install-ready counts and footprint totals.
- Scan orphaned `/sdcard/Android/data` and `/sdcard/Android/obb` entries.
- Delete leftover headset data from the orphaned-data popup.
- Surface long-running operations, failures, and setup work through Live instead of inline banners wherever possible.
- Fall back to generated artwork surfaces when remote or cached artwork URLs fail to load.

## Build and Packaging

- Package for macOS, Windows, and Linux through `electron-builder`.
- Produce unsigned local macOS arm64 DMG/ZIP builds.
- Use the current rounded vault-door icon set across app platforms.

## Current Boundaries

- Metadata remains enrichment rather than authoritative install/index truth.
- Backup Storage entries are still treated separately from Local Library entries.
- vrSrc depends on remote source availability and managed/system extraction tooling.
- Some device metrics depend on what the connected headset and ADB shell expose at scan time.
