# QuestVault 0.9.15

## Highlights
- Apps & Games cards now show the real on-disk library size for local payloads.
- Grid tiles now support direct `Install Now` and `Install Local Upgrade` actions from the status pill.
- Local Library grouping keeps materially different payload families separate while collapsing normal version variants more reliably.

## Included Changes
- Local Library sizing now prefers the indexed payload footprint instead of matched metadata size when rendering Apps & Games cards.
- Grid view status pills for local items now launch installs and upgrades directly, while tile clicks still open the detail card.
- Grouping now avoids merging special payload families such as `MR-Fix`, `Custom Tracks`, `Update Only`, `Patreon`, and `LSV`.
- Duplicate grouping is more resilient when older local payloads contain noisy package-like artifact names.
- Install progress and follow-up verification are surfaced more consistently in the queue.

## Fixes
- Fixed local library cards that showed a smaller matched metadata footprint instead of the actual on-disk payload size.
- Fixed Apps & Games grouping so noisy asset filenames no longer split ordinary version variants into separate tiles.
- Fixed direct grid install affordances so action pills can start installs without opening the detail card first.

## Validation
- `pnpm typecheck`
- `pnpm build`
