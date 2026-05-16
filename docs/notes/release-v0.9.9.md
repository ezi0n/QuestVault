# QuestVault 0.9.9

## Highlights
- vrSrc artwork now renders more reliably in packaged first-run installs after a remote sync.
- Packaged release builds are now cut from freshly rebuilt production output instead of whatever stale `out/**/*` tree may already exist locally.

## Included Changes
- Normalized local vrSrc artwork URLs and kept the custom `qam-asset` protocol backward-compatible with older cached artwork paths.
- Registered the `qam-asset` scheme as a privileged Electron protocol and added a packaged-mode same-origin asset fallback for local vrSrc artwork.
- Repaired staged `meta.next` artwork references when reading cached vrSrc catalogs and generated promoted catalogs against the final live `meta/` path.
- Hardened the release workflow by rebuilding `out/**/*` before packaging the app.

## Fixes
- Freshly installed packaged builds no longer depend on stale staged vrSrc artwork paths after a successful sync.
- Packaged builds no longer risk shipping older renderer or main-process code when packaging is run without a fresh production build first.

## Validation
- `pnpm typecheck`
- `pnpm build`
- unsigned macOS arm64 build from a fresh `out/` rebuild
