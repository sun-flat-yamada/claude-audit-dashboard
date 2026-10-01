# Security Policy

## Supported Versions

| Version             | Supported          | Security Fixes |
| ------------------- | ------------------ | -------------- |
| 0.1.x (2026.09 LTS) | :white_check_mark: | Active         |

---

## Reporting a Vulnerability

We take the security and privacy of **claude-audit-dashboard** very seriously.

If you believe you have discovered a security vulnerability or credential leak issue in this repository:

1. **DO NOT** create a public GitHub Issue.
2. Please report the security concern via **GitHub Private Vulnerability Reporting** by navigating to the **Security** tab of this repository and clicking **Report a vulnerability**.
3. Alternatively, contact the maintainers directly via security advisory channels.

### Information to Include

- Detailed steps to reproduce the issue.
- Impact assessment (e.g., potential unauthorized access, data leakage).
- Remediation suggestions or proof of concept (if available).

We will acknowledge receipt of your vulnerability report within 48 hours and provide a timeline for resolution.

---

## Security Best Practices for Deployments

1. **Anthropic API Keys (`ANTHROPIC_ENTERPRISE_API_KEY`, optional overrides `ANTHROPIC_COMPLIANCE_API_KEY` / `ANTHROPIC_ANALYTICS_API_KEY` / `ANTHROPIC_ADMIN_API_KEY`)**:
   - Never commit API keys directly into Git repositories.
   - Always configure them via **GitHub Actions Repository Secrets**; workflows pass them only to the steps that call the API.
   - Grant read-only scopes only (`read:compliance_activities`, `read:compliance_org_data`, `read:members`, `read:rbac_groups`, `read:analytics`, `read:spend_limits`). Never grant `read:compliance_user_data`, `write:*` or `delete:*` — rule AK-002 flags keys that hold write or delete scopes.
   - Rotate keys at least every 180 days (rule AK-003).
2. **Notification Webhooks (`SLACK_WEBHOOK_URL`, `DISCORD_WEBHOOK_URL`)**:
   - Store incoming webhook URLs exclusively as repository Secrets.
3. **GitHub Pages Visibility**:
   - Pages show the synthetic sample unless the repository variable `PAGES_DATA_SOURCE=live` is set. Set it only when the Pages site is access-controlled (Private Pages on GitHub Enterprise Cloud); see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

---

## Multi-Layered Secret & PII Protection Architecture (Defense-in-Depth)

This repository implements a 4-layered defense-in-depth security model based on industry best practices (GitHub Secret Scanning, Google Antigravity Agent Rules, GitGuardian, OWASP API Security):

1. **Layer 1: Agent Guardrails & Behavioral Rules (`.agents/rules/`, `GEMINI.md`, `AGENTS.md`)**:
   - Autonomous AI coding assistants are bound by always-on directives prohibiting hardcoded secrets, API tokens, and internal PII in code and chat context.
2. **Layer 2: Local & Git Exclusion Hygiene (`.gitignore`)**:
   - Comprehensive OWASP-compliant exclusion covering private keys (`*.pem`, `id_rsa`), certificates, cloud credentials, `.env*`, and audit snapshots.
3. **Layer 3: Autonomous Agent Audit Skill (`.agents/skills/secret-guard/`) & Local Scanners (`pnpm secret-scan`, `pnpm fork:verify`)**:
   - High-performance regex and pattern scanner (`scripts/secret-scan.ts`) that verifies 0 violations before any commit or PR.
4. **Layer 4: Automated CI/CD Enforcement (`.github/workflows/secret-scan.yml`)**:
   - Dual-engine scanning (Built-in scanner + Gitleaks Action) running on every pull request and push to enforce zero-leakage branch protection.
