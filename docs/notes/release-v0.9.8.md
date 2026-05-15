# QuestVault 0.9.8

## Highlights
- vrSrc sync now keeps the last working cached catalog live until a replacement metadata archive has downloaded, extracted, and rebuilt successfully.
- Re-syncing against an unchanged vrSrc metadata archive now leaves the current local cache untouched instead of needlessly replacing it.

## Included Changes
- Changed the vrSrc sync flow to download `meta.7z`, extract metadata, and rebuild the catalog in staged paths before promoting the new cache into place.
- Added archive comparison so identical vrSrc metadata downloads can exit cleanly without replacing the current local cache.
- Preserved explicit cache-clearing behavior for manual reset flows while making normal sync safer.

## Fixes
- Failed vrSrc syncs no longer wipe the cached remote catalog and leave the Apps & Games vrSrc view empty.
- vrSrc sync no longer clears the previous archive and extracted metadata before the replacement metadata has proven valid.

## Validation
- `pnpm typecheck`
- `pnpm build`
- unsigned macOS arm64 build
