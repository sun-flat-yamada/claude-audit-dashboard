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

**Q: Will our employee names, workspaces, and audit events be publicly exposed?**  
A: No. When configured for enterprise usage, you can deploy the dashboard to **GitHub Pages Private Visibility** (available in GitHub Enterprise) or keep the repository private. Furthermore, sample datasets use purely synthetic identities.

**Q: What Anthropic API keys are required?**  
A: You need an Anthropic Admin API Key (`sk-ant-admin...`) to query members and workspaces, and a Compliance Access Key (`sk-ant-api...`) which requires Organization Primary Owner authorization to access audit activity streams.

### 3. Reporting Bugs or Requesting Features
- To report a bug: [Open a Bug Report](https://github.com/sun-flat-yamada/claude-audit-dashboard/issues/new?template=bug_report.yml)
- To suggest an enhancement: [Open a Feature Request](https://github.com/sun-flat-yamada/claude-audit-dashboard/issues/new?template=feature_request.yml)
