---
name: billing-report
description: >
  Generate comprehensive monthly billing reports for Claude Enterprise
  Organizations with workspace-level cost allocation, model breakdown,
  and full raw data export.
---

# Billing Report Skill

## Purpose

Generate monthly billing reports that can be used for:
1. Internal charge-back to teams/departments (by workspace)
2. Budget tracking and forecasting
3. Executive summary reporting
4. Audit trail for financial compliance

## When to Activate

- Monthly report workflow triggers billing report generation
- User requests billing data or cost reports
- User asks about workspace-level cost allocation

## Data Sources

### Admin API Endpoints

- **Usage Report**: `GET /v1/organizations/usage_report/messages`
  - Parameters: `start_time`, `end_time`, `group_by` (workspace, model)
  - Granularity: `1d` (daily buckets)
  - Returns: input_tokens, output_tokens, cached_input_tokens, cache_creation_tokens

- **Cost Report**: `GET /v1/organizations/cost_report`
  - Parameters: `start_time`, `end_time`, `group_by` (workspace, model)
  - Returns: costs in USD cents (decimal strings)

### Billing Report Structure

```json
{
  "report_id": "billing-2026-09",
  "month": "2026-09",
  "generated_at": "2026-10-01T03:00:00Z",
  "organization": {
    "id": "org_xxx",
    "name": "My Organization"
  },
  "summary": {
    "total_cost_usd": 4230.50,
    "total_input_tokens": 125000000,
    "total_output_tokens": 42000000,
    "total_cached_tokens": 15000000,
    "total_cache_creation_tokens": 5000000,
    "average_daily_cost_usd": 141.02,
    "projected_annual_cost_usd": 50766.00,
    "month_over_month_change_pct": 5.2
  },
  "by_workspace": [
    {
      "workspace_id": "ws_001",
      "workspace_name": "Engineering",
      "cost_usd": 2750.00,
      "percentage_of_total": 65.0,
      "input_tokens": 80000000,
      "output_tokens": 28000000,
      "by_model": [
        {
          "model": "claude-sonnet-4-20250514",
          "cost_usd": 1800.00,
          "input_tokens": 55000000,
          "output_tokens": 20000000
        }
      ]
    }
  ],
  "by_model": [
    {
      "model": "claude-sonnet-4-20250514",
      "cost_usd": 2850.00,
      "percentage_of_total": 67.4,
      "input_tokens": 95000000,
      "output_tokens": 32000000,
      "cost_per_million_input": 3.00,
      "cost_per_million_output": 15.00
    }
  ],
  "daily_breakdown": [
    {
      "date": "2026-09-01",
      "cost_usd": 145.20,
      "input_tokens": 4800000,
      "output_tokens": 1600000
    }
  ],
  "raw_records": []
}
```

## Report Generation Steps

1. **Determine target month** — From input or default to previous month
2. **Fetch usage data** — Call `usage_report/messages` with daily granularity, grouped by workspace and model
3. **Fetch cost data** — Call `cost_report` with same parameters
4. **Aggregate summaries** — Calculate totals, percentages, MoM changes
5. **Generate workspace allocations** — Per-workspace cost breakdown for charge-back
6. **Include raw records** — Full daily breakdown for audit trail
7. **Write report** — Save to `data/reports/monthly/YYYY-MM/billing-summary.json`
8. **Format notifications** — Create Slack/Discord/Email formatted summaries

## Claude Built-in Commands

- **`/plan`** — Plan the data fetching and aggregation strategy
- **Sequential Thinking** — Step through complex billing calculations

## Notification Format

### Slack Summary
```
📊 Monthly Billing Report — September 2026
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total Cost: $4,230.50 (+5.2% MoM)
Total Tokens: 167M (125M input / 42M output)

Top Workspaces:
  Engineering:  $2,750.00 (65.0%)
  Research:     $1,050.50 (24.8%)
  Marketing:    $430.00  (10.2%)

Top Models:
  Sonnet 4:   $2,850.00 (67.4%)
  Opus 4:     $1,050.50 (24.8%)
  Haiku 3:    $330.00   (7.8%)

📎 Full report: <dashboard-url>
```
