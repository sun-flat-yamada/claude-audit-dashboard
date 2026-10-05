# Setup Guide

This guide sets up the Claude Enterprise Audit Dashboard for one Claude Enterprise tenant.
For hosting choices (who can see the dashboard), read [DEPLOYMENT.md](DEPLOYMENT.md) first.

## Prerequisites

1. **Claude Enterprise** with the Compliance API enabled for your organization, and access to the **primary owner** account (only the primary owner can create the key).
2. A **Private or Internal** fork of this repository.
3. For local runs: **Node.js >= 22.13** and **pnpm >= 9**.

## Step 1: Create the Enterprise API key

1. Sign in to claude.ai as the primary owner.
2. Open **Organization settings → API** and create a key. It starts with `sk-ant-api01-`.
3. Grant **only** these scopes:

   | Scope                        | Used for                                                    |
   | ---------------------------- | ----------------------------------------------------------- |
   | `read:compliance_activities` | Activity Feed                                               |
   | `read:compliance_org_data`   | Linked organizations, effective settings, API key inventory |
   | `read:members`               | Members and pending invites                                 |
   | `read:rbac_groups`           | RBAC groups and their members                               |
   | `read:analytics`             | Per-user activity, DAU/WAU/MAU, usage and cost              |
   | `read:spend_limits`          | Effective spend limits and period-to-date spend             |

   Do **not** grant `read:compliance_user_data` (conversation content), `read:org_audit`, or any `write:*` / `delete:*` scope. Rule AK-002 flags keys holding write or delete scopes.

4. Copy the key once; it is not shown again.

Missing scopes do not break collection: the affected datasets are reported as `unavailable` with the API's message (which names the missing scope), the rules that need them are `skipped`, and rule OP-002 fails until coverage is complete.

> [!NOTE]
> If your security policy splits scopes across several keys, store the main key as `ANTHROPIC_ENTERPRISE_API_KEY` and override individual API families with `ANTHROPIC_COMPLIANCE_API_KEY`, `ANTHROPIC_ANALYTICS_API_KEY` or `ANTHROPIC_ADMIN_API_KEY`.

## Step 2: Repository secrets and variables

**Settings → Secrets and variables → Actions**:

| Name                                                                                       | Kind     | Required | Value                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------ | -------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_ENTERPRISE_API_KEY`                                                             | Secret   | Yes      | The key from Step 1                                                                                                                                                    |
| `ANTHROPIC_COMPLIANCE_API_KEY` / `ANTHROPIC_ANALYTICS_API_KEY` / `ANTHROPIC_ADMIN_API_KEY` | Secret   | No       | Per-API overrides                                                                                                                                                      |
| `SLACK_WEBHOOK_URL`                                                                        | Secret   | No       | Slack Incoming Webhook URL                                                                                                                                             |
| `DISCORD_WEBHOOK_URL`                                                                      | Secret   | No       | Discord webhook URL                                                                                                                                                    |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS`                                      | Secret   | No       | SMTP server (`SMTP_SECURE=true` is implied for port 465)                                                                                                               |
| `ALERT_EMAIL_FROM` / `ALERT_EMAIL_TO`                                                      | Secret   | No       | Sender and comma-separated recipients                                                                                                                                  |
| `DASHBOARD_URL`                                                                            | Variable | No       | Dashboard link included in alerts and reports                                                                                                                          |
| `ENABLE_SCHEDULED_JOBS`                                                                    | Variable | No       | `true` enables the schedules (set it after Step 4)                                                                                                                     |
| `PAGES_DATA_SOURCE`                                                                        | Variable | No       | `live` publishes live data to Pages — see [DEPLOYMENT.md](DEPLOYMENT.md)                                                                                               |
| `PAGES_DETAIL_DATA`                                                                        | Variable | No       | `true` (with `PAGES_DATA_SOURCE=live`) also publishes per-person detail files and the effective configuration; Private Pages only — see [DEPLOYMENT.md](DEPLOYMENT.md) |

Workflows declare their own token permissions; no change to the repository's default workflow permissions is needed.

## Step 3: GitHub Pages

1. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. The first deployment shows the synthetic sample (`data/sample/`). Live data is published only when `PAGES_DATA_SOURCE=live`.

## Step 4: First collection

1. **Actions → Collect Audit Data → Run workflow**.
2. The run restores stored data from the `data/audit` branch (created on the first successful run), collects every dataset, evaluates the rules, writes the dashboard data, archives old snapshots, sends alerts and saves everything back to `data/audit`.
3. Check the log line `Snapshot …: N/13 datasets collected` and the warnings that follow it. Each `unavailable` dataset names its reason (missing key or scope, API not enabled, …).
4. When coverage looks right, set `ENABLE_SCHEDULED_JOBS=true`.

Schedules once enabled:

| Workflow             | When                                                         | What                                                   |
| -------------------- | ------------------------------------------------------------ | ------------------------------------------------------ |
| `collect-audit.yml`  | Every 6 hours                                                | Collect, check, dashboard data, archive, alerts        |
| `weekly-report.yml`  | Mondays 09:00 UTC                                            | Weekly digest (previous 7 days), sent to every channel |
| `monthly-report.yml` | 1st of the month 03:00 UTC                                   | Cost report for the previous month (or a chosen month) |
| `deploy-pages.yml`   | Push to main; after collection when `PAGES_DATA_SOURCE=live` | Dashboard build and deployment                         |

## Step 5: Tune the rules (optional)

`config/default.json` — thresholds and switches (full list in [BLUEPRINT appendix A](BLUEPRINT.md#付録-a-設定スキーマ)):

```json
{
  "compliance": {
    "disabledRules": ["CF-003"],
    "params": {
      "UA-002": { "monthlyBudget": 25000, "currency": "USD" },
      "AC-001": { "inactiveDays": 60 }
    }
  },
  "notifications": {
    "statuses": ["fail", "warning"],
    "minSeverity": "high",
    "cooldownMinutes": 360
  }
}
```

`config/custom-rules.json` — add configuration baselines (`CF-xxx`) and activity watches (`AM-xxx`) without code; see [BLUEPRINT §7.3](BLUEPRINT.md#73-カスタムルール-コード不要). Invalid values stop the run with a precise message instead of being ignored.

## Local runs

```bash
git clone https://github.com/YOUR_ORG/claude-audit-dashboard.git
cd claude-audit-dashboard
pnpm install

# Without a key: synthetic tenant
pnpm demo        # refreshes data/sample/
pnpm dev         # http://localhost:5173/claude-audit-dashboard/

# With a key
cp .env.example .env    # fill in ANTHROPIC_ENTERPRISE_API_KEY (never commit .env)
pnpm pipeline           # collect → check → data/dashboard.json
pnpm dev                # now shows your data (data/ is gitignored)
pnpm report:weekly
pnpm report:monthly --month 2026-09   # also writes data/detail/monthly/ for the dashboard's monthly cost report
```

To look at the data collected by Actions locally, restore it first: `.github/scripts/data-branch.sh restore`.

## Capturing real responses as test fixtures (maintainers)

Used to turn the response shapes of a real tenant into the synthetic fixtures under `packages/collector/src/adapters/anthropic/__tests__/fixtures/tenant/` (Phase B1). Needs a key, so run it locally or in a private repository, never in CI and never in a public repository.

```bash
# 1. Capture (opt-in, off by default). One file per request: endpoint, query, status, body.
#    Request headers and the key are never stored. Refused when CI=true; the directory must be
#    outside the repository or under the gitignored data/raw/.
pnpm collect --capture-raw ../claude-audit-captures/run1     # or: CAPTURE_RAW_DIR=... pnpm collect

# 2. Sanitize into a fresh directory (e-mails -> userN@example.com, IDs -> synthetic IDs with the
#    same prefix and length, names -> synthetic names, IPs -> 192.0.2.0/24). One real ID always
#    becomes the same synthetic ID in every file, so Activity api_key_id still matches the key inventory.
pnpm sanitize ../claude-audit-captures/run1 packages/collector/src/adapters/anthropic/__tests__/fixtures/tenant

# 3. Review the result by eye, then check it and try it:
pnpm fork:verify && pnpm secret-scan
pnpm build:detail                              # write data/detail/*.json (members, API keys, activity, groups, effective configuration, archive inventory; part of pnpm pipeline)
pnpm fixture                                  # collect -> check -> dashboard.json from the fixtures, no key (writes data/fixture/, gitignored)
pnpm fixture:tenant --out ../fixture-out      # same, to another directory
```

Delete the raw capture after checking; never share or commit it. Only the sanitized fixtures go into a PR. The sanitizer refuses to write when an original value would remain in the output, but it cannot know every free-text field of a future API version, so always review the files.

## Notification channels

- **Slack** — create an [Incoming Webhook](https://api.slack.com/messaging/webhooks) and store its URL as `SLACK_WEBHOOK_URL`.
- **Discord** — Channel settings → Integrations → Webhooks → New webhook; store the URL as `DISCORD_WEBHOOK_URL`.
- **E-mail** — store the SMTP settings and `ALERT_EMAIL_TO` (comma-separated) as secrets.

Alerts contain rule IDs, counts and masked identifiers; review your channel's audience before connecting it.

### Acknowledging alerts

Every alert sent is listed on the dashboard's **Alerts** page (`#/alerts`, a read-only view; detail files, see [DEPLOYMENT.md](DEPLOYMENT.md)) with its id and acknowledgement status. Someone with write access to the repository acknowledges an alert by running the **Acknowledge Alert** workflow (Actions tab, `alert-id` and an optional `by-label`) or, locally with the stored data restored, `pnpm alerts ack <alert-id> [--by <label>]`. The acknowledgement is stored as `alerts/ack.json` on the `data/audit` branch. No extra secret or variable is needed.

## Troubleshooting

| Symptom                                         | Cause and fix                                                                                  |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Every dataset `unavailable: No key for …`       | `ANTHROPIC_ENTERPRISE_API_KEY` is not set for the workflow                                     |
| `unavailable` with a 403 message                | The key lacks the scope named in the message — add it in claude.ai (a new key may be required) |
| `settings` / `credentials` unavailable with 404 | The Compliance API organization settings endpoint is not available for your tenant yet         |
| OP-001 fails                                    | No successful collection in the last 24 hours — check the collect workflow                     |
| Score shows `(N of 30 rules assessed)`          | Some rules lacked data; see the dashboard's Data coverage section                              |
| `Invalid config/default.json`                   | The message lists each invalid field; fix it or remove the field to use the default            |
