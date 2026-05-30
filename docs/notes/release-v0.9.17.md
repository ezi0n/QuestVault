# QuestVault 0.9.17

## Highlights
- Live Operations now separates queued work from truly active work more clearly.
- Queue controls are more flexible, including better handling for waiting actions.

## Included Changes
- Waiting actions now stay in the queue until live work actually begins.
- Queued actions can now be paused, resumed, or cancelled earlier in the workflow.
- Progress reporting is more descriptive during copy, indexing, and install transitions.

## Fixes
- Fixed queued actions that looked active before any live work had started.
- Fixed waiting actions that did not expose controls consistently.
- Fixed progress states that could appear stalled near completion during operation handoffs.

## Validation
- `pnpm typecheck`
- `pnpm build`
- unsigned macOS arm64, x64, and universal builds
- unsigned Windows x64 and arm64 builds
- unsigned Linux x64 and arm64 builds
