# B2-4 F-006 Member view (#/members)

Closes #59. Refs #37 (tracking). Plan source: `.devs/changes/2026-10-04_DashboardDetailPagesPlan/implementation_plan.md` section B2-4 (owner accepted D1-D8). Prerequisites B2-0 (#49) and B2-2 (#57, PR #58) are merged.

## User Review Required

> [!IMPORTANT]
> No contract or demo-data change. The sample `detail/members.json` already has active, inactive (4) and pending-invite rows. The `detail-members` contract has no group membership field (only `organizationId`), so group membership is not shown; adding it would be a contract change owned by B2-2 / B2-10 (org-groups).

> [!WARNING]
> The screen shows per-person data. It reads only the masked-or-raw values the detail file holds (`maskPii` is decided by the collector), and the page states when values are masked (manifest `maskPii`).

## Proposed Changes

### packages/dashboard

#### [NEW] `src/lib/members-view.ts`

- Pure helpers: `memberStatus(member)` (`inactive` when `active === false`, `active`, `unknown` when `active === null`), `filterMembers(members, { query, role, status })`, `sortMembers(members, key, direction)`, `countByStatus`, `roleLabel`.

#### [NEW] `src/pages/Members.tsx`

- Loads `detail/members.json` and the manifest (for the `unavailable` reason and the `maskPii` note) with `useDetailFile`. States: loading, not published / not collected (404), unavailable dataset, error, empty. Search field, role and status filters, sortable columns, members table with status icon + label + color, inactive rows highlighted (threshold from the file's `inactiveDays`), pending invites table. Tables scroll inside their own container, never the page.

#### [MODIFY] `src/routes.tsx`, `src/components/Badges.tsx`

- Route `#/members` ("Members"); `inactive` / `active` / `unknown` status entries (icon + label + color).

### Tests

- `src/lib/__tests__/members-view.test.ts`: status derivation (null, never active, true/false), filter, sort, counts.
- `src/pages/__tests__/Members.test.tsx`: normal, empty, unavailable (manifest reason), missing file, error, `maskPii` on (masked values shown, note) and off (raw values), inactive highlight not colour-only, filter by role name.
- `src/__tests__/app.test.tsx`: deep link `#/members` renders sample data.

### Docs

- `docs/DASHBOARD-FEATURES.md` F-006 row and section; `docs/BLUEPRINT.md` section 9.

## Verification Plan

### Automated Tests

- `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`
- `pnpm lint && pnpm format:check && pnpm audit:deps`
- `pnpm demo` leaves `git diff --exit-code data/sample` clean.

### Manual Verification

- `DASHBOARD_DATA_SOURCE=sample pnpm dev`, open `#/members` at 390 px and in both themes.
