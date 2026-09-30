# Setup Guide

This guide walks you through setting up the Claude Enterprise Audit Dashboard.

## Prerequisites

1. **Node.js >= 22** — [Download](https://nodejs.org/)
2. **pnpm >= 9** — Install with `npm install -g pnpm`
3. **Claude Enterprise Organization** — With API access enabled

## Step 1: Get API Keys

### Admin API Key

1. Go to [Anthropic Console](https://console.anthropic.com/)
2. Navigate to **Settings > Admin API Keys**
3. Create a new Admin API Key
4. Copy the key (starts with `sk-ant-admin...`)

### Compliance Access Key

> ⚠️ Requires **Primary Owner** role

1. Go to **Organization Settings > Data and Privacy**
2. Navigate to **Compliance Access Keys**
3. Create a new Compliance Access Key
4. Copy the key

## Step 2: Fork & Clone

```bash
# Fork the repository on GitHub, then:
git clone https://github.com/YOUR_USERNAME/claude-audit-dashboard.git
cd claude-audit-dashboard
pnpm install
```

## Step 3: Configure

```bash
cp .env.example .env
```

Edit `.env` and add your API keys:

```env
ANTHROPIC_ADMIN_API_KEY=sk-ant-admin...
ANTHROPIC_COMPLIANCE_API_KEY=your-compliance-key
```

## Step 4: GitHub Secrets

For automated collection via GitHub Actions, add secrets to your repository:

1. Go to **Settings > Secrets and variables > Actions**
2. Add the following secrets:

| Secret | Value |
|--------|-------|
| `ANTHROPIC_ADMIN_API_KEY` | Your Admin API Key |
| `ANTHROPIC_COMPLIANCE_API_KEY` | Your Compliance Access Key |

### Optional: Notification Secrets

| Secret | Value |
|--------|-------|
| `SLACK_WEBHOOK_URL` | Slack Incoming Webhook URL |
| `DISCORD_WEBHOOK_URL` | Discord Webhook URL |
| `SMTP_HOST` | SMTP server hostname |
| `SMTP_PORT` | SMTP port (usually 587) |
| `SMTP_USER` | SMTP username |
| `SMTP_PASS` | SMTP password |
| `ALERT_EMAIL_TO` | Alert recipient email |

## Step 5: Enable GitHub Pages

1. Go to **Settings > Pages**
2. Set **Source** to **GitHub Actions**
3. The dashboard will be available at `https://YOUR_USERNAME.github.io/claude-audit-dashboard/`

## Step 6: Test Locally

```bash
# Collect data
pnpm collect:audit
pnpm collect:usage

# Run compliance checks
pnpm check:compliance

# Start dashboard
pnpm dev
```

## Step 7: Verify Automation

Scheduled workflows are **opt-in**, so a fresh fork does not fail every few hours before its secrets exist.
After the secrets from Step 4 are configured, go to **Settings > Secrets and variables > Actions > Variables**
and add the repository variable `ENABLE_SCHEDULED_JOBS` = `true`.

Once enabled, the following workflows run automatically:

- **Every 6 hours**: Collect audit data and run compliance checks (`collect-audit.yml`)
- **Every Monday at 9:00 UTC**: Generate and send weekly report (`weekly-report.yml`)
- **1st of each month at 3:00 UTC**: Monthly billing & usage report (`monthly-report.yml`)
- **On push to main / after collection**: Deploy dashboard to GitHub Pages (`deploy-pages.yml`)

You can also trigger workflows manually from the **Actions** tab.

## Notification Setup

### Slack

1. Create an [Incoming Webhook](https://api.slack.com/messaging/webhooks) in your Slack workspace
2. Copy the webhook URL
3. Add as `SLACK_WEBHOOK_URL` secret

### Discord

1. In your Discord server, go to **Channel Settings > Integrations > Webhooks**
2. Create a new webhook
3. Copy the webhook URL
4. Add as `DISCORD_WEBHOOK_URL` secret

### Email

1. Configure your SMTP server details
2. Add `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `ALERT_EMAIL_TO` as secrets
