---
name: secret-guard
description: Perform comprehensive security audit and self-review to detect and eliminate secrets, API keys, credentials, and internal PII from source files and git commits.
---

# 🛡️ Secret Guard & Privacy Audit Skill (`secret-guard`)

Use this skill when auditing changes, reviewing PRs, or verifying that no credentials, tokens, webhooks, or PII are exposed in the repository.

---

## Audit Workflow

### 1. Automated Secret Scan

Run the built-in multi-layered scanner:

```bash
npm run secret-scan
```

- **Exit code 0**: Repository is clean of known secret patterns and high-entropy anomalies.
- **Exit code 1**: Critical findings detected. Read the output report, locate the file and line, and remediate immediately.

### 2. Git Staging Hygiene Check

Inspect the current git status to confirm no ignored or sensitive files were accidentally staged:

```bash
git status -s
```

Ensure **NONE** of the following appear as tracked or untracked:

- `.env*` (except `.env.example`)
- `data/snapshots/` or `data/reports/`
- Any `*.pem`, `*.key`, `*.json` containing real employee names or API keys (`sk-ant-admin...`, `sk-ant-api...`)

### 3. Diff Inspection for High-Risk Patterns

If performing a git commit or review, run:

```bash
git diff --cached
```

Check for:

1. Hardcoded bearer tokens, passwords, or hashes.
2. Anthropic API keys (`sk-ant-...`).
3. Slack or Discord webhook URLs with live webhook tokens.
4. SMTP email server passwords.
5. Real internal employee email addresses or org hierarchy in code/test mocks.

### 4. Remediation Steps

If a secret or PII was accidentally written:

1. Replace with a standard mocked placeholder:
   - Anthropic Admin Key: `sk-ant-admin-mock000000000000000000000000`
   - Anthropic Compliance Key: `sk-ant-api-mock000000000000000000000000`
   - Slack Webhook: `https://hooks.slack.com/services/T00000000/B00000000/mock000000000000`
   - User Email: `alice.engineer@example.com`
2. If the secret was already committed to local git history, unstage/reset and prune it before pushing.
3. If a real credential was exposed to any remote, revoke and rotate the credential immediately.
