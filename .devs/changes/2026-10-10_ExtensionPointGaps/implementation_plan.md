# Implementation Plan - Extension-point Gaps (#88)

## Context & Problem
Issue #88 identifies 5 extension-point design gaps found while adding optional adapters in #87 (Refs #39). To adhere to the architecture directive that new datasets/adapters require only new files + registry entry, the extension points must be refactored:
1. `config-view.ts`: The presenter lists `DATASET_NAMES` itself, so a registered dataset never reaches `#/config` on its own.
   - Fix: Derive the dataset list from registered collectors or input `registeredDatasets`, rather than a hardcoded constant.
2. `packages/collector/src/infrastructure/env.ts` & `main/container.ts`: Key families are known by hardcoded names (`keys.compliance/analytics/admin/console`).
   - Fix: Introduce a declarative `KEY_FAMILIES` registry (id, envVar, fallbackToEnterprise) read by `env.ts` and `container.ts`.
3. `packages/collector/src/adapters/storage/repositories.ts`: Hand-kept `SORT_KEYS` table for deterministic snapshot storage.
   - Fix: Allow datasets to register their sort key function via a registry (`registerStorageSortKey` / `DATASET_SORT_KEYS`), keeping existing sort orders byte-identical.
4. `packages/collector/src/__tests__/synthetic-history.ts`: Hardcoded `CHANGE_PERIOD` table and exhaustive `switch` statement for `variant`.
   - Fix: Replace the hardcoded `switch` with a declarative per-dataset history rule registry, keeping default periods and variants next to the dataset definition or registry.
5. `classify` export & `configPatch`: Ensure `classify` is exported cleanly and `configPatch` in `container.ts` enables profiles to supply config adjustments without temporary directories.
6. Documentation: Update `docs/ARCHITECTURE.md` section 8.3 to reflect the single-registration recipe.

## Proposed Changes

### 1. Core Presenter (`packages/core/src/application/presenters/config-view.ts`)
- In `ConfigViewInput`, add optional `registeredDatasets?: readonly DatasetName[]`.
- In `sourcesOf(input: ConfigViewInput)`, if `registeredDatasets` is provided, use it; otherwise fall back to `[...DATASET_NAMES, ...(input.enabledOptionalDatasets ?? [])]`.
- Update `packages/collector/src/main/config-view.ts` to pass `registeredDatasets: c.collectors.map(c => c.dataset)`.

### 2. Key Family Registry (`packages/collector/src/infrastructure/env.ts` & `main/container.ts`)
- Define `KEY_FAMILIES` array in `env.ts` with `{ id, envVar, fallbackToEnterprise }`.
- Make `readEnvironment` derive `keys` dynamically from `KEY_FAMILIES` while preserving type safety and backwards compatibility for `env.keys.compliance`, etc.
- In `container.ts`, use the registry to configure API gateways cleanly.

### 3. Storage Sort Table Registry (`packages/collector/src/adapters/storage/repositories.ts`)
- Formalize sort key registry: `DATASET_SORT_KEYS` with helper `registerStorageSortKey(name, fn)`.
- Ensure all existing sort functions are preserved so snapshot outputs remain byte-identical.

### 4. Synthetic History Rule Registry (`packages/collector/src/__tests__/synthetic-history.ts`)
- Replace the exhaustive `switch (name)` in `variant` with a rule dictionary mapping each dataset to its change period and variant generator function.
- Provide `registerSyntheticHistoryRule(name, rule)`.

### 5. Shared Error Classification & Container Config Hook
- Verify that `classify` is exported and used consistently across optional collectors.
- Verify `configPatch` in `container.ts` is fully documented and tested.

### 6. Documentation & Architecture Sync
- Update `docs/ARCHITECTURE.md` §8.3 to reflect the single-registration recipe.

### 7. Verification & Quality Gate
- Run `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build && pnpm lint`.
- Ensure sample data and golden tests remain byte-identical.
