# Headset Activity and Little Nightmares Install Chat

Date: 2026-04-29

## User Request

Investigate why QuestVault was not logging enough activity to diagnose headset install failures, reproduce the local library install for `Little Nightmares VR- Altered Echoes v22+1.0.26 -JF`, expose useful failure activity in Live, and keep the activity panel out of the way unless it is needed.

## Work Captured

- Confirmed QuestVault already had a headset action log at `headset-actions.ndjson`, but failed `adb install` and `adb push` steps were too opaque.
- Added richer install logging around standalone APK installs, folder APK installs, and OBB transfer failures.
- Added a `headset-actions:get-recent` IPC bridge so the renderer can read recent headset activity.
- Exposed Headset Activity inside the Live rail.
- Refined Headset Activity behavior so it is hidden by default, appears only after a new failed headset action, and disappears entirely from Live when closed.
- Fixed startup behavior so historical failures in the log do not reopen Headset Activity after app restart.

## Little Nightmares Diagnosis

The failed run for `Little Nightmares VR- Altered Echoes v22+1.0.26 -JF` showed:

- APK install started successfully.
- Managed ADB runtime resolved correctly.
- `com.Iconik.LittleNightmaresVR.apk` installed.
- The install then failed before OBB transfer with: `Installed APKs, but could not determine the package name required for OBB transfer.`

The local library index already had the correct package id:

- `com.Iconik.LittleNightmaresVR`

The bug was that folder installs inferred the OBB destination package name from OBB filenames before using the indexed package id. This title has many asset-style `.obb` files that do not match the old `main.version.package.obb` inference pattern, so the install stopped even though the correct package id was already known.

## Fix

Changed folder install logic to prefer `item.packageIds[0]` for the OBB destination package name, falling back to filename inference only when the library index does not provide a package id.

## Verification

- `pnpm typecheck` passed after the code changes.
- Reinstalled the Little Nightmares APK on headset `2G0YC5ZH8T025V`.
- Verified package installation: `package:com.Iconik.LittleNightmaresVR`.
- Created/pushed OBB payload to `/sdcard/Android/obb/com.Iconik.LittleNightmaresVR`.
- Confirmed `601 files pushed, 0 skipped`.
- Confirmed remote OBB count: `601`.
- Confirmed remote OBB footprint: `7,678,940 KB`.

## Follow-Up Context

The in-app browser at `http://localhost:5173/` can show the renderer dev page, but it does not have Electron preload access to `window.api`. Real install actions must run from the Electron app window or through the same underlying ADB path.
