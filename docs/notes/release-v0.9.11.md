# QuestVault 0.9.11

## Highlights
- First-run headset inventory bootstrapping now gives vrSrc a chance to sync and process `meta.7z` before the initial installed-app refresh continues.
- Installed Apps and Saved States recover more artwork from cached vrSrc data and richer hydrated metadata instead of staying on placeholder tiles.
- Path updates now trigger the relevant refresh work immediately after the folder is stored, and metadata refresh progress is clearer and faster.

## Included Changes
- Added guarded first-run vrSrc bootstrap sequencing ahead of the first headset inventory refresh, while still allowing startup to continue if sync fails.
- Backfilled installed-package artwork when detail hydration finds richer Meta store data.
- Added vrSrc artwork fallback to the Saved States view.
- Changed Local Library, Backup Storage, and Game Saves path updates to trigger the corresponding rescan or save-state refresh right after the new path is saved.
- Reworded metadata progress so lookup totals are described as expanded lookup targets rather than suspicious asset counts.
- Batched library and backup metadata lookup refreshes to reduce long-running sequential scans.
- Updated the packaged app identity to `com.questvault` and migrated macOS preferences from the legacy `com.apprenticevr.questvault` domain.

## Fixes
- First-run startup is less likely to miss vrSrc metadata before the first headset inventory pass.
- Saved States cards can now show cached artwork more consistently when the data already exists.
- Path changes no longer wait for a later manual action before refreshing the newly selected location.
- Metadata refresh progress no longer implies that lookup-target counts are the same as visible asset counts, and the refresh itself no longer crawls one package at a time.

## Validation
- `pnpm typecheck`
- `pnpm build`
- unsigned macOS arm64, x64, and universal builds
- unsigned Windows x64 and arm64 builds
- unsigned Linux x64 and arm64 builds
