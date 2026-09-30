---
name: report-generator
description: Generate weekly compliance digests and dispatch alerts to Slack, Discord, and Email based on compliance violations and risk levels.
---

# 📣 Report Generator & Notification Skill (`report-generator`)

Use this skill when testing alert channels, creating weekly report digests, or customizing notification message formatting.

---

## 🔔 Supported Channels

1. **Slack Webhook**:
   - Rich Block Kit formatting with score badges and violation itemization.
   - Requires `SLACK_WEBHOOK_URL`.
2. **Discord Webhook**:
   - Embeds with color-coded severity strips (Red: Critical, Orange: High, Yellow: Medium).
   - Requires `DISCORD_WEBHOOK_URL`.
3. **Email (SMTP)**:
   - Formatted HTML reports delivered via Nodemailer.
   - Requires `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `ALERT_EMAIL_TO`.

---

## 🛠️ Execution & Testing

```bash
# Dispatch notifications based on the latest report
pnpm notify
```
