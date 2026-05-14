# QuestVault 0.9.5

## Highlights
- Live Queue now exposes queued vrSrc transfers directly from the header so waiting remote downloads can be reviewed without leaving Live.
- Local Library sorting now supports true `Added` ordering based on a stable first-indexed timestamp, alongside `Title` and `Latest`.
- vrSrc startup behavior now automatically syncs after the GitHub update check finishes on each app launch.

## Included Changes
- Serialized vrSrc payload preparation and extraction so only one remote payload is unpacked at a time while keeping up to three concurrent vrSrc download lanes.
- Added a dedicated vrSrc queue dialog above the current workspace overlays so queued items are visible and layered correctly.
- Updated Local Library sort controls with explicit direction toggling and clearer `Latest` labeling.
- Updated release-facing docs for the vrSrc queue, startup sync, and added-date indexing behavior.

## Fixes
- Settings path changes and clears no longer lock the whole Library & Storage Paths section in a stuck `Opening…` state when one path becomes inaccessible.
- The vrSrc queue popup now opens above the active drawer instead of hiding underneath it.

## Validation
- `pnpm typecheck`
- `pnpm build`
- unsigned macOS arm64, x64, and universal builds
- unsigned Windows x64 and arm64 builds
- unsigned Linux x64 and arm64 builds
