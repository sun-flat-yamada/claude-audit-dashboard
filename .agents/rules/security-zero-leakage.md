---
name: security-zero-leakage
description: Enforce zero-leakage security guardrails preventing AI agents from outputting or committing secrets, credentials, and internal PII.
trigger: always_on
---

# 🔒 Security & Zero-Leakage Policy for AI Agents

You are pair programming in an enterprise-grade repository with strict security, privacy, and compliance requirements.
All AI agents operating in this workspace **MUST** adhere to the following non-negotiable rules.

---

## 1. Zero Secrets in Source Code & Artifacts

1. **NEVER Hardcode Real Secrets**:
   - Do NOT write or commit any real API keys, Personal Access Tokens (PAT), passwords, SSH keys, TLS private certificates, or cloud service account keys.
   - Prohibited patterns include:
     - Anthropic API keys (`sk-ant-admin...`, `sk-ant-api...`)
     - GitHub tokens (`ghp_`, `github_pat_`, `gho_`)
     - Slack webhooks (`https://hooks.slack.com/...`)
     - Discord webhooks (`https://discord.com/api/webhooks/...`)
     - SMTP passwords and email credentials
     - Cloud keys (`AKIA...`, `AIza...`, OpenAI `sk-...`)
2. **Mock & Testing Credentials**:
   - If mock tokens or test data are required, you **MUST** use explicitly fake placeholders (e.g., `sk-ant-admin-mock000000000000000000000000`, `sk-ant-api-mock000000000000000000000000`).
   - Never use strings that resemble real high-entropy tokens.
3. **Safe Credentials Protocol**:
   - Never print `.env` or secret files to stdout or read full `.env` files into LLM context.
   - Check `.env.example` for reference templates.

---

## 2. Zero PII Leakage (Audit Events & User Profiles)

1. **User Identity Isolation**:
   - Real employee names, internal departments, personal email addresses, and organizational structures **MUST NEVER** be committed to the Git repository.
   - Sample and mock data must use synthetic names (e.g., `Alice Engineer`, `user_alice@example.com`).
2. **Commit Sanitization**:
   - Before executing any `git commit`, `git add`, or editing files intended for version control, ensure that no local `data/snapshots/*.json`, `data/reports/*.json`, or `.env` files are tracked or included in diffs.

---

## 3. Storage & Branch Isolation (Fork-Safe)

1. **Data Files in Main Branch Prohibited**:
   - Never commit raw or processed audit snapshot files (`data/snapshots/`, `data/reports/`) to the `main` branch.
   - Only static schema definitions and `data/sample/` mock files are allowed in version control.

---

## 4. Mandatory Pre-Commit / Pre-PR Self-Review

Before concluding any implementation or proposing commits:
1. Run the local automated secret scanner:
   ```bash
   npm run secret-scan
   ```
2. Verify that the scan exits with code `0` (Clean).
3. If any secret or suspicious high-entropy string is flagged, remediate it immediately before presenting your response to the user.
