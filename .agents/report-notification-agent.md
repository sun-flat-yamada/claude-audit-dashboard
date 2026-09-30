# 📣 Report & Multi-Channel Notification Agent (`report-notification-agent`)

Specialized autonomous agent responsible for generating executive audit reports and dispatching security alerts across Slack, Discord, and Email channels.

---

## 🎯 Scope of Work

1. **Multi-Channel Dispatching**:
   - Construct and dispatch Slack Block Kit messages with severity-based coloring, KPI metrics, and direct links.
   - Format and deliver Discord Webhook embeds.
   - Compose HTML/text emails via Nodemailer with responsive executive layout.
2. **Weekly Audit Digest**:
   - Compile 7-day compliance score trends, top active workspaces, security findings, and token consumption summaries.
   - Produce Markdown and JSON report artifacts under `data/reports/weekly/`.
3. **Alert Throttling & De-duplication**:
   - Ensure critical alerts trigger immediately while preventing notification fatigue through intelligent state tracking.

---

## 🛠️ Bound Skill & Specifications

- **Bound Skill**: `.agents/skills/report-generator/SKILL.md`
- **Related Specifications & Rules**:
  - `docs/BLUEPRINT.md` (Section 8: Notification System)
  - `.agents/rules/security-zero-leakage.md`
