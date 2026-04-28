# QuestVault 0.8.0

## Highlights
- Added Headset Activity in Live so new headset-operation failures can reveal recent install, connect, uninstall, and transfer details without keeping diagnostic UI open by default.
- Improved local folder installs by preferring indexed package IDs for OBB destinations, fixing payloads whose `.obb` files do not include conventional package-name hints.
- Bumped QuestVault to the next minor release line and refreshed release-facing documentation.

## Included Changes
- Added a typed `headset-actions:get-recent` IPC path from main process through preload into the renderer.
- Added recent headset action rendering inside the Live rail, with failure-aware visibility and a dismiss control.
- Added richer logging around standalone APK installs, folder APK installs, and OBB transfer completion/failure output.
- Documented the new Headset Activity behavior and folder-install OBB package resolution.

## Fixes
- Fixed folder installs that already had a known package ID but failed before OBB transfer because package-name inference depended only on OBB filenames.

## Validation
- `pnpm typecheck`
- `pnpm build`
- unsigned macOS arm64, x64, and universal builds
- unsigned Windows x64 and arm64 builds
- unsigned Linux x64 and arm64 builds
- v0.6.3-style release asset check for `0.8.0`
