# QuestVault 0.9.7

## Highlights
- Queued installs now run strictly one at a time across vrSrc, Local Library, and manual installs: the next item does not begin until the previous install has finished verification and cleared from the Live Queue.
- Local Library duplicate/version grouping is more reliable, including mixed-case and duplicated package identifiers from indexed payloads.
- Metadata refresh now shows visible progress in the main UI instead of looking stalled when background metadata work is active.

## Included Changes
- Added a main-process verification barrier and renderer queue handoff so install progress, verification, and queue completion stay serialized end to end.
- Normalized and deduplicated package IDs before computing Local Library group identities, and reordered grouping fallbacks to prefer package and release identity over weaker folder-based matches.
- Surfaced metadata refresh progress in the button label and Live Queue card so long-running updates show current progress and activity details.

## Fixes
- Packaged releases now match the current compiled app output when built through the full build pipeline, avoiding stale runtime behavior that could differ from the dev app.
- Duplicate local entries such as mixed-case package variants no longer split into separate visible groups when they belong to the same release lineage.

## Validation
- `pnpm typecheck`
- `pnpm build`
- unsigned macOS arm64, x64, and universal builds
- unsigned Windows x64 and arm64 builds
- unsigned Linux x64 and arm64 builds
