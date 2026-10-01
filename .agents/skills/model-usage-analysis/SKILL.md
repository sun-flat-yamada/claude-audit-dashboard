---
name: model-usage-analysis
description: >
  Analyze Claude Enterprise model usage and spend (by model, product and RBAC group),
  cache efficiency and seat utilization; explain or extend the built-in analyzers that
  produce dashboard and report insights.
---

# Model Usage Analysis Skill

## Purpose

1. Identify model mix and concentration (e.g. most spend on the largest model)
2. Find cost optimization opportunities (model routing, prompt caching)
3. Spot spend concentration in one RBAC group and low seat utilization
4. Compare trends across months using the stored snapshots and monthly reports

## When to Activate

- A user asks about model usage, spending patterns or optimization
- Insights on the dashboard or in a report need explaining
- A new analysis should be added

## Built-in Analyzers (`packages/core/src/domain/analysis/analyzers.ts`)

| ID                    | Requires   | Fires when                                                       | Suggests                                      |
| --------------------- | ---------- | ---------------------------------------------------------------- | --------------------------------------------- |
| `model-concentration` | `cost`     | One model holds more than 60% of spend                           | Route routine tasks to a smaller model        |
| `cache-efficiency`    | `usage`    | Cache reads below 30% of input tokens (at least 1M input tokens) | Use prompt caching for long, repeated context |
| `group-concentration` | `cost`     | One RBAC group holds more than 80% of spend                      | Check that usage matches the team's needs     |
| `seat-utilization`    | `adoption` | Monthly adoption rate below 50%                                  | Review assigned seats                         |

Analyzers whose datasets were not collected are skipped. Insights appear on the dashboard, in the weekly digest and in the monthly report.

## Data

| Question                                   | Where                                                                       |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| Spend by model / product / group (30 days) | `data/dashboard.json` → `usage.byModel`, `usage.byProduct`, `usage.byGroup` |
| Daily tokens incl. cache reads             | latest snapshot `usage.json` (`cacheReadInputTokens`, …)                    |
| A full month                               | `data/reports/monthly/monthly-YYYY-MM.*` (`pnpm report:monthly`)            |
| Adoption                                   | snapshot `adoption.json` (DAU / WAU / MAU, seats)                           |

Run locally without a key on the synthetic tenant: `pnpm demo` (insights in `data/sample/dashboard.json` and the sample reports).

## Adding an Analysis

Implement `Analyzer { id, requires, analyze(data) → Insight[] }` as a pure function and add it to `BUILTIN_ANALYZERS`. Keep thresholds as named constants, add a test with the demo data, and describe the insight in this table. See `docs/PLUGIN-ARCHITECTURE.md` §6.
