# QuestVault Release Skill Chat

Date: 2026-04-28

## User Request

Build a Codex skill that can:

- Ask whether the next QuestVault version bump is major, minor, or patch.
- Bump the version.
- Update associated documentation and the manual.
- Commit all release changes.
- Look at the QuestVault `0.6.3` release and build only the same unsigned release assets.
- Push a new GitHub release that mentions changes and fixes in the new version.
- Capture this chat into the QuestVault notes folder.

## Work Captured

- Used the `skill-creator` workflow.
- Inspected QuestVault release/build files, including `package.json`, `docs/BUILD.md`, `docs/MANUAL.md`, and release-related documentation.
- Queried the GitHub `v0.6.3` release with `gh release view`.
- Confirmed `v0.6.3` shipped 14 unsigned assets across macOS, Windows, and Linux.
- Created local skill scaffold `questvault-release` under `/Users/goldskin/.codex/skills`.

## v0.6.3 Asset Pattern

- `QuestVault-0.6.3-arm64-mac.zip`
- `QuestVault-0.6.3-arm64-win.zip`
- `QuestVault-0.6.3-arm64.AppImage`
- `QuestVault-0.6.3-arm64.dmg`
- `questvault-0.6.3-arm64.tar.gz`
- `QuestVault-0.6.3-mac.zip`
- `QuestVault-0.6.3-universal-mac.zip`
- `QuestVault-0.6.3-universal.dmg`
- `QuestVault-0.6.3-x64-win.zip`
- `QuestVault-0.6.3.AppImage`
- `QuestVault-0.6.3.dmg`
- `questvault-0.6.3.tar.gz`
- `QuestVault.Setup.0.6.3-arm64.exe`
- `QuestVault.Setup.0.6.3-x64.exe`
