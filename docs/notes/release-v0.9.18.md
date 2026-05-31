# QuestVault 0.9.18

## Highlights
- Getting the current state fully polished before new directional changes.
- Queue and live operation handling is clearer and more resilient.
- Library and installed inventory browsing now feels more consistent across views.
- Ratings and sort controls are more visible and easier to use in gallery workflows.

## Included Changes
- Active operations now clean up more reliably when background work stops or the app is restarted.
- Queue recovery is stronger after app close or interruption, with clearer retry states for unfinished work.
- Library update and upgrade behavior is more consistent across package matching scenarios.
- Installed inventory controls now match the broader Apps & Games control style more closely.
- Gallery cards now surface storefront-style star ratings more consistently where metadata is available.
- Sort controls now use direct selection instead of cycling through modes, with clearer explicit options.

## Fixes
- Fixed stale operation cards that could remain visible after the underlying work had already stopped.
- Fixed version comparison edge cases that could surface incorrect upgrade states.
- Fixed package selection cases where older local variants could appear as the primary visible entry.
- Fixed inconsistent control presentation between library and installed inventory views.

## Validation
- `pnpm typecheck`
- `pnpm build`
- unsigned macOS arm64, x64, and universal builds
- unsigned Windows x64 and arm64 builds
- unsigned Linux x64 and arm64 builds
