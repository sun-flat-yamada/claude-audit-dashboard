---
name: billing-report
description: >
  Generate and explain the monthly Claude Enterprise cost report: cost by product,
  model and RBAC group (charge-back), daily breakdown and raw cost records, from the
  Enterprise Analytics API.
---

# Billing Report Skill

## Purpose

Monthly cost reports for:

1. Internal charge-back to teams (by RBAC group)
2. Budget tracking (rule UA-002 checks month-to-date cost and the end-of-month forecast)
3. Executive summaries
4. An audit trail of spend

## When to Activate

- The monthly report workflow runs (`monthly-report.yml`, 1st of the month 03:00 UTC)
- A user asks for cost data, charge-back by group, or spend by product / model

## Data Sources (Enterprise Analytics API, scope `read:analytics`)

| Endpoint                                        | Used for                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------ |
| `GET /v1/organizations/analytics/cost_report`   | Daily cost: total and `group_by[]` = `product`, `model`, `rbac_group_id` |
| `GET /v1/organizations/analytics/usage_report`  | Daily tokens (uncached input, cache read, cache creation, output)        |
| `GET /v1/organizations/rbac_groups` (Admin API) | Group names for the charge-back table (`read:rbac_groups`)               |

Facts that change the numbers (see `docs/API-MAPPING.md`):

- Amounts are cents as decimal strings; the adapter divides by 100.
- Values can be revised for up to 30 days — re-run a month later for invoicing-grade totals.
- A member's spend is attributed to **every** group they belonged to, so group rows can add up to more than the total. Totals always come from the ungrouped rows.
- Claude Enterprise has no Console workspaces; Console `usage_report/messages` and `cost_report` are not used.

## Generate

```bash
pnpm report:monthly                    # previous calendar month
pnpm report:monthly --month 2026-09    # a specific month (YYYY-MM, validated)
pnpm report:monthly --month 2026-09 --notify
```

Output in `data/reports/monthly/` (saved to the `data/audit` branch by the workflow):

| File                                     | Content                   |
| ---------------------------------------- | ------------------------- |
| `monthly-YYYY-MM.md` / `.html` / `.json` | Full report               |
| `monthly-YYYY-MM.cost-by-product.csv`    | Cost and share by product |
| `monthly-YYYY-MM.cost-by-model.csv`      | Cost and share by model   |
| `monthly-YYYY-MM.cost-by-group.csv`      | Charge-back by RBAC group |
| `monthly-YYYY-MM.daily-breakdown.csv`    | Daily cost and tokens     |
| `monthly-YYYY-MM.raw-cost-records.csv`   | Every cost row used       |

Summary KPIs: total cost, average daily cost, projected annual cost (×12), total tokens; plus insights from the analyzers.

## Extending

The report is a `ReportDefinition` (`packages/core/src/application/use-cases/reports.ts`) returning a format-neutral document; new sections appear in every output format automatically. See `docs/PLUGIN-ARCHITECTURE.md` §7.
