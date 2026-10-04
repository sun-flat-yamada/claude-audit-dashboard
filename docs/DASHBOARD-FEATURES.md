# Dashboard Feature Requirements

> **Status:** Living document. Phase A (dashboard v2) implemented; Phase B items are planned.
> **Last updated:** 2026-10-01
> **Data contract:** `DashboardView` schemaVersion 2 (`packages/core/src/contracts/dashboard-view.ts`)

---

## Principles

- **Claude Enterprise vocabulary.** Enterprise tenants are organized as _linked organizations_ and _RBAC groups_; there are no Console workspaces. Breakdowns use product, model and RBAC group.
- **Aggregates only in `dashboard.json`.** The file may be published on Pages, so it carries counts, totals and masked identifiers. Views that need per-person data (member list, key inventory) require a separate, access-controlled data file (Phase B).
- **Honest coverage.** Every view that depends on a dataset says so when it was not collected; the score is shown with the number of rules actually assessed.
- **One system of charts.** Fixed categorical color order, legend for two or more series, a table view for every chart, no dual axes, status shown with icon + label + color, light and dark themes, no horizontal scroll at 390 px.

---

## Feature matrix

| ID    | Feature                         | Priority | Status                                                    | Contract fields                                  |
| ----- | ------------------------------- | -------- | --------------------------------------------------------- | ------------------------------------------------ |
| F-001 | Organization overview           | P0       | ✅ Phase A                                                | `title`, `organizations`, `collectedAt`, `kpis`  |
| F-002 | Compliance score and trend      | P0       | ✅ Phase A                                                | `kpis[score]`, `compliance.history`              |
| F-003 | Compliance results              | P0       | ✅ Phase A + CSV / JSON export (B2-1)                     | `compliance.results`, `compliance.byCategory`    |
| F-004 | Usage and cost                  | P0       | ✅ Phase A                                                | `usage.daily`, `usage.byProduct/byModel/byGroup` |
| F-005 | Activity                        | P0       | 🔶 Aggregates in Phase A; search in Phase B               | `activity`                                       |
| F-006 | Member view                     | P1       | ⏳ Phase B                                                | separate access-controlled file                  |
| F-007 | API key inventory               | P1       | ⏳ Phase B                                                | separate access-controlled file                  |
| F-008 | Alert history                   | P1       | ⏳ Phase B                                                | notification state                               |
| F-009 | Monthly cost report view        | P1       | 🔶 Files in Phase A; viewer in Phase B                    | `data/reports/monthly/*`                         |
| F-010 | Model usage analytics           | P1       | 🔶 Phase A (spend by model, insights); heatmap in Phase B | `usage.byModel`, `insights`                      |
| F-011 | Light / dark theme              | P2       | ✅ Phase A (follows system); toggle UI in Phase B2 (B2-9) | —                                                |
| F-012 | Organization / group drill-down | P2       | ⏳ Phase B                                                | —                                                |
| F-013 | Data coverage and retention     | P2       | ✅ coverage in Phase A; archive inventory in Phase B      | `coverage`                                       |
| F-014 | Configuration view (read-only)  | P2       | ⏳ Phase B                                                | —                                                |
| F-015 | Snapshot comparison             | P3       | ⏳ Later                                                  | —                                                |
| F-016 | Adoption (DAU / WAU / MAU)      | P1       | ✅ Phase A                                                | `adoption`                                       |
| F-017 | Insights                        | P1       | ✅ Phase A                                                | `insights`                                       |

---

## Implemented (Phase A)

### F-001 Organization overview

- Header: dashboard title, linked organization names, last collection time, a "Demo data" badge when `source = demo`.
- KPI tiles: open findings (failed + warnings), members, monthly active users, seat utilization (30 days), month-to-date cost. A tile shows `—` when its dataset was not collected.

### F-002 Compliance score and trend

- Hero figure: score out of 100 with the failed / to-review / error / skipped counts.
- When rules were skipped or errored, a warning line states `N of M rules assessed` and points to Data coverage.
- Score trend (single series, 0–100 axis) appears once two or more reports exist.

### F-003 Compliance results

- Status filter (All / Fail / Review / Error / Skipped / Pass) with counts.
- Order: fail, error, warning, skipped, pass; then severity; then rule ID.
- Each row expands to the remediation text and up to 20 evidence items (masked).
- Failing rules by category as labeled bars (`failed of evaluated`).
- Own page at `#/compliance` (also on the Overview).
- Export (client-side, nothing is uploaded): "Export CSV (<filter>)" / "Export JSON (<filter>)" for the filtered view and "Export all CSV" / "Export all JSON" for every result. File names are `compliance-results-<collection date yyyymmdd>[-<status>].csv|json`.
- CSV: the first five columns (`Rule, Name, Severity, Status, Message`) are `COMPLIANCE_EXPORT_COLUMNS` from `@claude-audit/core/contracts`, shared with `pnpm report:compliance`; then `Category, Remediation, Evidence`. RFC 4180 quoting, CRLF; cells starting with `=` `+` `-` `@`, tab or CR get a leading `'` (spreadsheet formula-injection guard). JSON lists the same fields with a fixed key order and names the filter.

### F-004 Usage and cost

- Daily cost: line with a 10% area wash, crosshair tooltip, compact axis ticks, exact values in the tooltip and table view.
- Daily tokens: input (including cache reads and writes) and output as two lines with a legend.
- Spend by product, by model and by RBAC group: horizontal bars with the amount and share at the tip. Group shares can exceed 100% in total because a member can belong to several groups (noted in the card).
- Phase B: cache read share over time, budget progress (UA-002 already reports month-to-date and forecast).

### F-005 Activity (aggregates)

- Total events in the last collection window, with the window bounds.
- Top 10 activity types as labeled bars.
- Events matched by activity-watch rules (AM-xxx): time, type, rule, masked actor (up to 30).
- Phase B: a searchable timeline needs a paged, access-controlled activity export rather than `dashboard.json`.

### F-011 Light / dark theme

- Follows `prefers-color-scheme`; `data-theme="light|dark"` on `<html>` forces a theme.
- Phase B2 (B2-9): a Light / Dark / System switch in the primary navigation (group "Theme", buttons with `aria-pressed`, keyboard operable). The choice is stored in `localStorage` (`claude-audit-theme`); an inline script in `index.html` applies it before first paint. Every storage access is guarded: when storage is blocked the page renders the default (system) theme and the switch still works for the session. "System" removes `data-theme`.
- Categorical series colors (slots 1–3) validated for both themes; the light-theme third slot is below 3:1 contrast, so every multi-series chart ships a legend and a table view.

### F-013 Data coverage

- One row per dataset: status badge (Collected / Unavailable / Error), record count, source endpoint (or `projection:<name>`), and the reason or `as of` time.
- Rules that need an uncollected dataset are listed as skipped, never as passed.

### F-016 Adoption

- Daily, weekly and monthly active users as three lines with a legend (the weekly and monthly series converge, so values are read from the tooltip and table rather than end labels).
- Subtitle: assigned seats, pending invites and monthly adoption rate from the latest summary.

### F-017 Insights

- Title and detail of each analyzer result (model concentration, cache efficiency, group concentration, seat utilization) with its priority.

---

## Planned (Phase B and later)

| ID    | Scope                                                                                                                                |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------ |
| F-006 | Members with roles, last activity and group membership; inactive members highlighted (AC-001). Needs an access-controlled data file. |
| F-007 | Key inventory with scopes, age and last use (AK-001…AK-003).                                                                         |
| F-008 | History of alerts sent (from the notification state) and their acknowledgement status.                                               |
| F-009 | In-app viewer for `data/reports/monthly/*` with charge-back tables per RBAC group.                                                   |
| F-010 | Model × group heatmap (sequential single-hue scale with a legend), trend of model mix.                                               |
| F-012 | Drill-down per linked organization or RBAC group: members, settings deviations (CF-xxx), spend.                                      |
| F-013 | Archive inventory (years, snapshot counts, sizes).                                                                                   |
| F-014 | Read-only view of the effective configuration: disabled rules, parameters, custom rules, notification policy.                        |
| F-015 | Compare two snapshots or two reports: rules that changed status, datasets that changed coverage.                                     |

---

## Non-functional requirements

| Area          | Requirement                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------- |
| Compatibility | The UI rejects `dashboard.json` with another `schemaVersion` and explains how to regenerate it |
| Performance   | One JSON file (aggregates); no runtime API calls; code-split React bundle                      |
| Accessibility | Table view for every chart; status never color-only; keyboard-operable filters and details     |
| Privacy       | E-mail addresses masked by default (`dashboard.maskPii`); sample data uses `example.com` only  |
| Testing       | Unit tests for view helpers and data loading; E2E (Playwright) in Phase B                      |
