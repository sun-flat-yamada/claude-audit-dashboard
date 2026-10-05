# Walkthrough: B2-10 F-012 Org / group drill-down

Closes #65. Refs #37.

## What changed

- **Pages** (`packages/dashboard/src/pages/{Organizations,OrganizationDetail,GroupDetail}.tsx`, routes `#/orgs`, `#/orgs/<id>`, `#/groups/<id>`; nav entry "Organizations", sub-routes keep it current via `navPath`): the index lists linked organizations (members, deviation count) and RBAC groups (source, members, month-to-date spend) with a search, plus an "Unattributed deviations" card for CF-xxx rows whose `organizationId` is null. The organization page shows its deviations (severity and status as icon / dot + label + color) and its members (joined by `organizationId` from `detail/members.json`, printed as published with a `maskPii` note). The group page shows source, member count, spend and its share of the highest-spending group (never summed). States: loading, not published, not collected (manifest reason), error, empty, no match, unknown id.
- **Helpers** (`lib/drilldown-view.ts`, pure) and `components/DeviationsTable.tsx`; reuses `DetailControls.tsx`.
- **Docs**: `docs/DASHBOARD-FEATURES.md` F-012, `docs/BLUEPRINT.md` section 9.2. No contract change; no demo change.

## Verification Results

| Stage  | Command                                                         | Result        |
| :----- | :-------------------------------------------------------------- | :------------ |
| Gate   | `pnpm fork:verify && typecheck && test && secret-scan && build` | Pass (exit 0) |
| Lint   | `pnpm lint`                                                     | Pass (exit 0) |
| Format | `pnpm format:check`                                             | Pass (exit 0) |
| Audit  | `pnpm audit:deps`                                               | Pass (exit 0) |

Tests added: helper unit; component (index, organization, group: links, counts, deviations, unattributed bucket, filters and no match, members joined and `maskPii` on / off, empty, not published, not collected, error, loading, unknown id, synthetic sample); App deep links on the sample files.

## Caveats

- The plan names `#/orgs/<id>` and `#/groups/<id>`; the `#/orgs` index was added so they are reachable (not `#/organizations`).
- The contract has no group member list, so the group page only shows `memberCount`. Deviations are attributed to organizations only; the group page has no deviations of its own. Spend exists per group only, so the organization page has none. Closing these gaps would need a contract change (schema bump, golden, fork:verify).
- Demo data is unchanged: assigning organization IDs to the synthetic members changes AC-002/AC-003 (single primary owner) and the compliance score. In the sample all members have a null `organizationId`, so the organization member list shows a "members carry no organization" state; the joined list is covered by component tests with synthetic data. The sample has no unattributed deviation either (covered by component tests).
- Links from Members and Compliance evidence (plan sketch) are not added; Members rows do not display an organization today.
- Layout (390 px, light / dark) follows existing token and wrapping patterns and was not checked in a real browser; B5 (#40) covers E2E / a11y.
