# Support Policy

Thank you for using **claude-audit-dashboard**!

## How to Get Help

### 1. Documentation & Specifications

Before asking for support, please review:

- [Documentation Blueprint](docs/BLUEPRINT.md): Central specification for architecture, data models, rules, and APIs.
- [Setup Guide](docs/SETUP.md): Step-by-step setup and credentials configuration.
- [README.md](README.md) & [README.ja.md](README.ja.md): Project overview and quick start guides.

### 2. Frequently Asked Questions (FAQ)

**Q: Do I need a paid external database or server?**  
A: No. The platform is 100% serverless, operating purely within GitHub Actions (scheduled cron jobs) and GitHub Pages (SPA hosting).

**Q: Will our employee names, groups, and audit events be publicly exposed?**  
A: Not by default. Live data stays on the `data/audit` branch of your private repository, and GitHub Pages shows the synthetic sample unless you set `PAGES_DATA_SOURCE=live` (do this only with access-controlled Pages). The dashboard masks e-mail addresses, and the sample uses purely synthetic identities.

**Q: What Anthropic API keys are required?**  
A: One Claude Enterprise key (`sk-ant-api01-...`) created by the primary owner in claude.ai (Organization settings → API) with read-only scopes: `read:compliance_activities`, `read:compliance_org_data`, `read:members`, `read:rbac_groups`, `read:analytics`, `read:spend_limits`. Datasets whose scope is missing are reported as unavailable instead of failing the run. See [docs/SETUP.md](docs/SETUP.md).

### 3. Reporting Bugs or Requesting Features

- To report a bug: [Open a Bug Report](https://github.com/sun-flat-yamada/claude-audit-dashboard/issues/new?template=bug_report.yml)
- To suggest an enhancement: [Open a Feature Request](https://github.com/sun-flat-yamada/claude-audit-dashboard/issues/new?template=feature_request.yml)
