# QuestVault 0.8.1

## Highlights
- Added queued vrSrc transfer handling so downloads and installs can be resumed after restart and drain through Live instead of disappearing when the app relaunches.
- Added headset inventory and maintenance counts that separate visible apps from hidden companion packages, making the scan history and Installed Apps & Games counters easier to read.
- Refreshed the maintenance panel layout and Live queue presentation to better surface long-running work.

## Included Changes
- Added persistent vrSrc queued-request storage plus startup resume handling in the main process.
- Added queued vrSrc request draining and restore logic so transfers can continue after a relaunch.
- Added visible/hidden installed-app accounting to the headset scan history and Installed Apps & Games summary.
- Updated the Live queue, maintenance, and status surfaces to display the new counts and queue state more clearly.

## Fixes
- Fixed headset inventory counts so hidden companion packages no longer inflate the visible app total.
- Fixed vrSrc long-running requests so queued transfers survive a restart instead of being lost in memory.

## Validation
- `pnpm typecheck`
- `pnpm build`
- unsigned macOS arm64, x64, and universal builds
- unsigned Windows x64 and arm64 builds
- unsigned Linux x64 and arm64 builds
- v0.6.3-style release asset check for `0.8.1`
