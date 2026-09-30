# Dashboard Feature Requirements Specification

> **Status:** Living Document — features are developed incrementally  
> **Reference:** [github-copilot-dashboard](https://github.com/sun-flat-yamada/github-copilot-dashboard/)  
> **Last Updated:** 2026-09-29

---

## Overview

This document defines the complete feature set planned for the Claude Enterprise Audit Dashboard.
Each feature includes its priority, implementation status, and references to relevant Anthropic API documentation.

---

## F-001: Organization Overview

**Priority:** P0 — Must Have  
**Status:** 🔲 Planned

### Description
Display a high-level overview of the Claude Enterprise Organization including member count, workspace count, active API key count, and current compliance score.

### Data Sources
- Admin API: `GET /v1/organizations/users` ([ref](https://docs.anthropic.com/en/api/admin-api))
- Admin API: `GET /v1/organizations/workspaces` ([ref](https://docs.anthropic.com/en/api/admin-api))
- Admin API: `GET /v1/organizations/api_keys` ([ref](https://docs.anthropic.com/en/api/admin-api))

### UI Components
- KPI cards (Members, Workspaces, API Keys, Compliance Score)
- Organization name & ID display
- Last collection timestamp

---

## F-002: Compliance Score & Trend

**Priority:** P0 — Must Have  
**Status:** 🔲 Planned

### Description
Display the current compliance score (0-100) with a 30-day trend chart. Show the number of passed, failed, and warning checks with severity breakdown.

### Data Sources
- Generated from: Compliance check results (internal)
- Rule definitions: `packages/shared/src/constants/audit-rules.ts`

### UI Components
- Compliance score gauge/circle
- Trend line chart (30 days)
- Status breakdown bar (pass/fail/warn)
- Severity distribution pie chart

---

## F-003: Compliance Check Results Table

**Priority:** P0 — Must Have  
**Status:** 🔲 Planned

### Description
Detailed table of all compliance check results with rule ID, name, status, severity, message, evidence, and remediation guidance.

### Data Sources
- Generated from: Compliance report JSON

### UI Components
- Sortable/filterable data table
- Status badges (pass/fail/warn)
- Severity icons
- Expandable row for evidence and remediation
- Export to CSV/JSON

---

## F-004: Usage & Cost Dashboard

**Priority:** P0 — Must Have  
**Status:** 🔲 Planned

### Description
Visualize API usage (tokens) and costs (USD) with breakdowns by workspace, model, and time period.

### Data Sources
- Admin API: `GET /v1/organizations/usage_report/messages` ([ref](https://docs.anthropic.com/en/api/admin-api))
- Admin API: `GET /v1/organizations/cost_report` ([ref](https://docs.anthropic.com/en/api/admin-api))

### UI Components
- Daily/Weekly/Monthly token usage area chart
- Cost trend line chart
- Workspace usage pie chart
- Model usage breakdown bar chart
- Input vs Output token ratio
- Cache hit rate visualization
- Budget utilization progress bar

---

## F-005: Activity Log Viewer

**Priority:** P0 — Must Have  
**Status:** 🔲 Planned

### Description
Searchable, filterable timeline of audit activities collected from the Compliance API.

### Data Sources
- Compliance API: `GET /v1/compliance/activities` ([ref](https://docs.anthropic.com/en/api/compliance-api))

### UI Components
- Activity timeline with category icons
- Filter by category (admin, identity, configuration, resource, access, security)
- Filter by date range
- Search by actor, target, event type
- Activity detail panel
- Export to CSV

---

## F-006: Member Management View

**Priority:** P1 — Should Have  
**Status:** 🔲 Planned

### Description
View all organization members with their roles, last active dates, and workspace memberships. Highlight inactive members.

### Data Sources
- Admin API: `GET /v1/organizations/users` ([ref](https://docs.anthropic.com/en/api/admin-api))

### UI Components
- Members table with role, last active, created date
- Inactive member highlighting (configurable threshold)
- Role distribution chart
- Workspace membership matrix

---

## F-007: API Key Management View

**Priority:** P1 — Should Have  
**Status:** 🔲 Planned

### Description
Display all API keys with status, age, last usage, scope, and creator. Flag unused or unscoped keys.

### Data Sources
- Admin API: `GET /v1/organizations/api_keys` ([ref](https://docs.anthropic.com/en/api/admin-api))

### UI Components
- API keys table with status badges
- Age indicator (color-coded by rotation need)
- Scope visualization (workspace assignment)
- Usage sparkline
- Key lifecycle timeline

---

## F-008: Alert Dashboard

**Priority:** P1 — Should Have  
**Status:** 🔲 Planned

### Description
Centralized view of all active, acknowledged, and resolved alerts. Includes alert history and trend.

### Data Sources
- Generated from: Alert engine results (internal)

### UI Components
- Active alerts list with severity badges
- Alert detail panel
- Alert trend chart
- Acknowledge/resolve actions (state stored in data branch)
- Alert rule configuration viewer

---

## F-009: Monthly Billing Report View

**Priority:** P1 — Should Have  
**Status:** 🔲 Planned

### Description
Monthly usage and cost reports with group-level (workspace) aggregation and full raw data breakdown. Supports billing charge-back to internal teams.

### Data Sources
- Admin API: `GET /v1/organizations/usage_report/messages` ([ref](https://docs.anthropic.com/en/api/admin-api))
- Admin API: `GET /v1/organizations/cost_report` ([ref](https://docs.anthropic.com/en/api/admin-api))

### UI Components
- Month selector
- Summary cards (total cost, total tokens, model breakdown)
- Workspace cost allocation table
- Model usage comparison chart
- Raw data table (all individual usage records)
- CSV/JSON export for billing integration
- Year-over-year comparison

---

## F-010: Model Usage Analytics

**Priority:** P1 — Should Have  
**Status:** 🔲 Planned

### Description
Analyze AI model usage patterns and provide optimization recommendations. Identify model mix inefficiencies, overuse of expensive models, and suggest cost-saving alternatives.

### Data Sources
- Admin API: `GET /v1/organizations/usage_report/messages` ([ref](https://docs.anthropic.com/en/api/admin-api))
- Admin API: `GET /v1/organizations/cost_report` ([ref](https://docs.anthropic.com/en/api/admin-api))

### UI Components
- Model utilization heatmap (workspace × model)
- Cost-per-token comparison across models
- Trend of model mix over time
- Recommendation cards (e.g., "Switch from Opus to Sonnet for workspace X")
- Cached vs uncached input token ratio
- Cache creation efficiency chart

---

## F-011: Dark Mode & Theme Support

**Priority:** P2 — Nice to Have  
**Status:** 🔲 Planned

### Description
System-aware dark mode with manual toggle. Persistent theme preference.

### UI Components
- Theme toggle in header
- System preference detection
- Consistent dark mode across all components and charts

---

## F-012: Workspace Detail View

**Priority:** P2 — Nice to Have  
**Status:** 🔲 Planned

### Description
Drill-down view for individual workspaces showing members, API keys, usage, and activities specific to that workspace.

### Data Sources
- All Admin API endpoints filtered by workspace_id

### UI Components
- Workspace info header
- Members list
- API keys scoped to workspace
- Usage chart
- Activity stream

---

## F-013: Data Retention & Archive View

**Priority:** P2 — Nice to Have  
**Status:** 🔲 Planned

### Description
View data retention status, archive history, and storage usage. Anthropic retains audit logs for 6 years; this system provides independent long-term storage.

### UI Components
- Retention policy display
- Archive history table
- Storage size tracking
- Data age distribution chart

---

## F-014: Notification Configuration View

**Priority:** P2 — Nice to Have  
**Status:** 🔲 Planned

### Description
View the current notification channel configuration and alert rule definitions. (Configuration changes require editing config files or GitHub secrets.)

### UI Components
- Channel status cards (Slack, Discord, Email)
- Alert rule table
- Notification history log

---

## F-015: Comparison & Diff View

**Priority:** P3 — Future  
**Status:** 🔲 Planned

### Description
Compare compliance reports across time periods. Show what changed between collection runs.

### UI Components
- Period selector (compare any two dates)
- Diff table showing added/removed/changed findings
- Score delta visualization

---

## Feature Priority Matrix

| Priority | Features | Target Phase |
|----------|----------|-------------|
| **P0** | F-001 ~ F-005 | Phase 3 (Dashboard v1) |
| **P1** | F-006 ~ F-010 | Phase 4 (Dashboard v2) |
| **P2** | F-011 ~ F-014 | Phase 5 (Polish) |
| **P3** | F-015 | Future |
