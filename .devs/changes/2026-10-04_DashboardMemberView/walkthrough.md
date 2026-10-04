# Walkthrough: B2-4 F-006 member view

Closes #59. Refs #37.

## What changed

- **Page** (`packages/dashboard/src/pages/Members.tsx`, route `#/members`, nav entry "Members"): reads `detail/members.json` and the manifest through `useDetailFile`. Table of member (name, e-mail), role, last activity date and status; inactive (AC-001) rows are tinted and carry an icon + label, the threshold text comes from the file's `inactiveDays`. Search, role filter, status filter with counts, sort (inactive first by default), pending invites table. Tables sit in their own `overflow-x-auto` container; cells wrap.
- **Helpers** (`lib/members-view.ts`, pure): `memberStatus` (`active === null` is `unknown`, never inactive), filter, sort (stable, id tie-break), counts, role labels.
- **Badges**: `active` / `inactive` / `unknown` status entries (icon + label + color).
- **States**: loading, not published (404), not collected (manifest `unavailable` with its reason), error (alert), no members, no filter match. A note states whether `maskPii` is on.
- **Docs**: `docs/DASHBOARD-FEATURES.md` (F-006 row and section, Planned entry removed), `docs/BLUEPRINT.md` section 9.2.
- No contract, collector or demo-data change; `data/sample/` is untouched.

## Verification Results

| Stage      | Command                                           | Result         |
| :--------- | :------------------------------------------------ | :------------- |
| Gate       | `pnpm fork:verify && typecheck && test && secret-scan && build` | Pass (exit 0) |
| Lint       | `pnpm lint`                                       | Pass (exit 0)  |
| Format     | `pnpm format:check`                               | Pass (exit 0)  |
| Audit      | `pnpm audit:deps`                                 | Pass (exit 0)  |

Tests added: helper unit (status, filter, sort, counts), component (normal, inactive highlight, threshold from data, invites, filters, sort, `maskPii` on and off, empty, unavailable, not published, error, loading, synthetic sample), App deep link `#/members` on sample detail files.

## Caveats

- Group membership is not in the `detail-members` contract (only `organizationId`), so it is not shown; the contract change is left to the group drill-down unit (B2-10).
- The sample has no "never active vs. long inactive" distinction: `lastActiveOn` is null for its 4 inactive members, shown as "No activity recorded".
- Layout (390 px, light / dark) follows the existing token and wrapping patterns and was not checked in a real browser here; B5 (#40) covers E2E / a11y.
