---
name: compliance-checker
description: Execute 10+ built-in compliance checks, calculate posture scores (0-100), identify security violations, and generate structured compliance audit reports.
---

# 🔍 Compliance Checker Skill (`compliance-checker`)

Use this skill when auditing compliance rules, implementing new checks, modifying thresholds, or validating compliance scoring logic.

---

## 📋 Rule Categories & Built-in Rules

| Category | Rule ID | Title | Default Threshold | Severity |
| :--- | :--- | :--- | :--- | :--- |
| **Access Control** | AC-001 | Inactive Members | 90+ days without login | Medium |
| **Access Control** | AC-002 | Excessive Admin Ratio | > 20% of total members | High |
| **Access Control** | AC-003 | Primary Owner Verification | Must be verified active | Critical |
| **API Keys** | AK-001 | Inactive API Keys | 30+ days without activity | Medium |
| **API Keys** | AK-002 | Unscoped API Keys | Unrestricted workspace scope | High |
| **API Keys** | AK-003 | API Key Age | 180+ days old | Medium |
| **Usage Anomaly** | UA-001 | Token Consumption Spike | > 3x trailing 7-day average | High |
| **Usage Anomaly** | UA-002 | Cost Budget Exceeded | > 100% monthly limit | Critical |
| **Data Governance**| DG-001 | Empty Workspaces | 0 members or 0 projects | Low |
| **Operations** | OP-001 | Collection Freshness | > 24 hours without sync | High |

---

## 🛠️ Execution & Diagnostics

```bash
# Run all compliance checks locally
pnpm check:compliance

# Output artifact locations:
# - data/reports/compliance-report-<timestamp>.json
# - data/reports/latest-report.json
```
