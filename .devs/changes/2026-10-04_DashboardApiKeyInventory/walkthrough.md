# Walkthrough: B2-5 F-007 API key inventory

Closes #61. Refs #37.

## What changed

- **Page** (`packages/dashboard/src/pages/ApiKeys.tsx`, route `#/keys`, nav entry "API keys"): reads `detail/api-keys.json` and the manifest through `useDetailFile`. Table of key (name and published/masked ID), scopes, age in days, expiry, last-used time and a recommendation (icon + label + color, plus the reason text). Search, recommendation filter with counts, sort (most urgent first by default). Tables sit in their own `overflow-x-auto` container; cells wrap.
- **Helpers** (`lib/keys-view.ts`, pure): age and idle days against the file's `generatedAt`, findings for AK-003 (rotate / expired / rotate soon), AK-001 (unused; never-seen keys are judged only once the observation window covers `unusedDays`, otherwise "use unknown"), AK-002 (write / delete scopes), primary recommendation, filter, sort, counts. Thresholds come from the file.
- **Shared controls** (`components/DetailControls.tsx`): `Notice`, `SelectField`, `SearchField`, `SortControls`, `FilterChips` and `detailNotice` extracted from the Members page and reused by both pages (no behaviour change for Members; its tests are unchanged).
- **Badges**: `key-*` status entries (icon + label + color).
- **Docs**: `docs/DASHBOARD-FEATURES.md` (F-007 row and section, Planned entry removed), `docs/BLUEPRINT.md` section 9.2.
- No contract, collector or demo-data change; `data/sample/` is untouched.

## Verification Results

See the PR description for the exact gate results.

| Stage  | Command                                                         | Result        |
| :----- | :-------------------------------------------------------------- | :------------ |
| Gate   | `pnpm fork:verify && typecheck && test && secret-scan && build` | Pass (exit 0) |
| Lint   | `pnpm lint`                                                     | Pass (exit 0) |
| Format | `pnpm format:check`                                             | Pass (exit 0) |
| Audit  | `pnpm audit:deps`                                               | Pass (exit 0) |

Tests added: helper unit (boundaries at / over each limit, null last use with short / long / missing observation window, non-compliance scopes, write scope, expired, deactivated, filter, sort, counts), component (every recommendation, thresholds from data, ordering, filters, sort, `maskPii` on and off, no key material, empty, unavailable, not published, error, loading, synthetic sample), App deep link `#/keys` on the sample detail files.

## Caveats

- "Rotate soon" at 80% of `maxAgeDays` is a display hint, not a compliance rule. The AK-002 `flaggedScopes` list is not in the detail file, so the built-in default (write / delete scopes) is used.
- The sample has no near-rotation key; that case is covered by unit and component tests with synthetic data instead of changing `data/sample/`.
- The plan's "fork:verify negative test for a key-like string in a detail file" was not added: the detail contract has no field for key material, and `secret-scan` covers `data/sample/`.
- Layout (390 px, light / dark) follows the existing token and wrapping patterns and was not checked in a real browser here; B5 (#40) covers E2E / a11y.
