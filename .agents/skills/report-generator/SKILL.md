---
name: report-generator
description: Generate compliance, weekly and monthly reports (Markdown, HTML, CSV, JSON) and dispatch alerts and digests to Slack, Discord, e-mail and the console according to the alert policy.
---

# 📣 Report Generator & Notification Skill (`report-generator`)

Use this skill when testing alert channels, generating reports, adding a report or output format, or changing message formatting.

---

## 🔔 Supported Channels

| Channel | Format                                               | Secrets                                                                                  |
| :------ | :--------------------------------------------------- | :--------------------------------------------------------------------------------------- |
| Console | Plain text (always on)                               | —                                                                                        |
| Slack   | Incoming Webhook, Block Kit (header, findings, link) | `SLACK_WEBHOOK_URL`                                                                      |
| Discord | Webhook embed colored by severity                    | `DISCORD_WEBHOOK_URL`                                                                    |
| E-mail  | nodemailer, text + escaped HTML                      | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `ALERT_EMAIL_FROM`, `ALERT_EMAIL_TO` |

Alert policy (`config/default.json` → `notifications`): `statuses` (default fail, warning), `minSeverity` (default high), `cooldownMinutes` (default 360).

---

## 🛠️ Execution & Testing

```bash
pnpm notify                                  # alert digest for the latest compliance report
pnpm notify --collect-status failure         # also announce a failed collection (used by CI)
pnpm report:compliance                       # data/reports/compliance/
pnpm report:weekly --notify                  # previous 7 days, then send the summary
pnpm report:monthly --month 2026-09 --notify # cost report for a month (re-reads Analytics)

# Unit tests use fake fetch / transports and assert the payloads
pnpm --filter @claude-audit/collector test
```

New reports return a `ReportDocument` and work with every renderer and channel; see `docs/PLUGIN-ARCHITECTURE.md` §7–9.
