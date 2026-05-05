# QuestVault 0.8.2

## Highlights
- Added headset reboot support from ADB Manager, plus a dedicated headset activity review dialog for inspecting recent installs, connects, uninstalls, and reboots.
- Added retry support for failed install queue items so headset installs can be re-run without repeating the entire setup flow.
- Refined installed-app refresh behavior so verification scans are labeled more clearly after installs complete.
- Refreshed the Live queue, headset activity panel, and maintenance surfaces to better surface long-running work and failure details.

## Included Changes
- Added a new `devices:reboot` IPC path, shared type support, and device-service handling for headset reboot operations.
- Added headset action log support for reboot events and a fuller review experience in the Live rail.
- Added live-queue retry handlers and a retry action for failed install cards.
- Adjusted installed-app refresh timing and verification labeling so post-install inventory checks read more clearly.

## Fixes
- Fixed headset activity logging so reboot actions are captured alongside the existing headset operations.
- Fixed the Live rail so new failure activity can be reviewed without automatically forcing the log open when the UI is intentionally suppressed.
- Fixed installed-app refreshes so verification passes wait for quiet queue state before running.

## Validation
- `pnpm typecheck`
- `pnpm build`
- unsigned macOS arm64, x64, and universal builds
- unsigned Windows x64 and arm64 builds
- unsigned Linux x64 and arm64 builds
- v0.6.3-style release asset check for `0.8.2`
