# Walkthrough - Resolve Extension-Point Gaps (#88)

## Overview
This change resolves the 5 extension-point design gaps identified while implementing optional adapters in #87 (Refs #39). New datasets and optional adapters can now be introduced cleanly through registration without altering existing core presenters, containers, storage sorting rules, or test history switches.

## Changes by Component

### 1. Dynamic Dataset Resolution in Presenter & Collector
- `packages/core/src/application/presenters/config-view.ts`:
  - Added `registeredDatasets?: readonly DatasetName[]` to `ConfigViewInput`.
  - Updated `sourcesOf` to derive sources from `registeredDatasets` when provided, rather than the hardcoded `DATASET_NAMES` constant.
- `packages/collector/src/main/config-view.ts`:
  - Implemented `registeredDatasets(c)` deriving dataset names from `c.collectors`, passing them to the config view presenter.

### 2. Declarative Key Family Registry
- `packages/collector/src/infrastructure/env.ts`:
  - Introduced `KeyFamilyDefinition`, `KEY_FAMILIES`, and `registerKeyFamily`.
  - Refactored `readEnvironment` to dynamically resolve keys from `KEY_FAMILIES` with secret sanitization while maintaining full type safety and backwards compatibility.
- `packages/collector/src/main/container.ts`:
  - Added `createHttpClientForFamily` helper to configure HTTP clients dynamically based on registered key family configurations.

### 3. Extensible Storage Sort Key Registry
- `packages/collector/src/adapters/storage/repositories.ts`:
  - Introduced `StorageSortKeyFn`, `SORT_KEYS` registry map, `registerStorageSortKey`, and `storageSortKeyFor`.
  - Kept all existing dataset sort rules byte-identical.

### 4. Synthetic History Rule Registry
- `packages/collector/src/__tests__/synthetic-history.ts`:
  - Replaced hardcoded `CHANGE_PERIOD` table and exhaustive `switch` in `variant` with `DatasetHistoryRule`, `SYNTHETIC_HISTORY_RULES`, and `registerSyntheticHistoryRule`.
  - Retained `CHANGE_PERIOD` as a backwards-compatible Proxy delegating to `SYNTHETIC_HISTORY_RULES`.

### 5. Shared Error Classification & Config Hook
- `packages/collector/src/adapters/anthropic/classify-error.ts`:
  - Extracted `UNAVAILABLE_STATUS` (401, 403, 404) and `classify` into a shared module.
- `packages/collector/src/adapters/anthropic/collectors.ts` & `optional-collectors.ts`:
  - Imported `classify` from `classify-error.js`, eliminating cross-adapter coupling.
- Added comprehensive unit tests in `packages/collector/src/adapters/anthropic/__tests__/classify-error.test.ts`.

### 6. Documentation
- `docs/ARCHITECTURE.md` §8.3:
  - Documented the single-registration recipe for both standard and optional datasets across domain, adapter, and test layers.

## Verification Results
- `pnpm fork:verify`: PASSED (all fixtures and sample datasets verified clean)
- `pnpm secret-scan`: PASSED (no secrets detected)
- `pnpm build`: PASSED (core, collector, dashboard)
- `pnpm typecheck`: PASSED (all packages)
- `pnpm lint`: PASSED (zero lint warnings/errors)
- `pnpm format:check`: PASSED (all files adhere to Prettier style)
- `pnpm audit:deps`: PASSED (zero vulnerabilities)
- `pnpm test`: PASSED (1,165 tests across core, dashboard, collector, scripts all green)
