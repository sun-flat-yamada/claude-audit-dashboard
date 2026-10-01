# 📣 Report & Multi-Channel Notification Agent (`report-notification-agent`)

Specialized autonomous agent responsible for generating audit reports and dispatching alerts across Slack, Discord, e-mail and the console.

---

## 🎯 Scope of Work

1. **Reports** (`packages/core/src/application/use-cases/reports.ts`):
   - `compliance`, `weekly` (previous 7 days: score and change, open findings, top activity types, 7-day cost, insights) and `monthly` (previous month: cost by product / model / RBAC group, daily breakdown, raw cost records, insights).
   - Reports are format-neutral `ReportDocument`s rendered to Markdown, HTML, CSV and JSON under `data/reports/<id>/`.
2. **Multi-Channel Dispatching** (`packages/collector/src/adapters/notifiers/`):
   - Slack Incoming Webhook (Block Kit: header, findings, dashboard link), Discord embed colored by severity, e-mail via nodemailer (text + escaped HTML), console.
   - A channel is registered only when its secrets exist; one failing channel does not stop the others.
3. **Alert Policy & De-duplication** (`planComplianceAlert`):
   - Select results by `notifications.statuses` and `minSeverity`; suppress the same result set within `cooldownMinutes`; titles carry the score with its coverage.

---

## 🛠️ Bound Skill & Specifications

- **Bound Skill**: `.agents/skills/report-generator/SKILL.md`
- **Related Specifications & Rules**:
  - `docs/BLUEPRINT.md` (Sections 10–11)
  - `.agents/rules/security-zero-leakage.md`
