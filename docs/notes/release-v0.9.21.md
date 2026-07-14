# QuestVault 0.9.21 - General fixes

## Highlights
- Improved Orphaned OBB / Data scanning so superseded OBB candidates are compared by real version rather than duplicate Quest storage aliases.

## Included Changes
- Orphaned OBB / Data results now show successful scan summaries above found items.

## Fixes
- Fixed false superseded OBB results caused by seeing the same Quest storage file through both `/sdcard` and `/storage/emulated/0`.
- Fixed superseded OBB detection so same-version files are retained and only lower-version same-kind OBB files are offered for cleanup.
- Fixed failed Orphaned OBB / Data scans appearing as "No cleanup candidates found."

## Validation
- `pnpm typecheck`
- `pnpm build`
- unsigned macOS arm64, x64, and universal builds
- unsigned Windows x64 and arm64 builds
- unsigned Linux x64 and arm64 builds
