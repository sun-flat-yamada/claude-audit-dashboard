---
name: audit-collector
description: Manage and execute ingestion of Anthropic Compliance and Admin API data, handling pagination, rate-limiting, snapshot archiving, and mock synthetic generation.
---

# 📡 Claude Audit Collector Skill (`audit-collector`)

Use this skill when developing, testing, or executing data collection pipelines against Anthropic's Claude Enterprise APIs.

---

## 🎯 Scope & Capabilities

1. **Compliance API Activity Stream**:
   - Collects organization audit events (`/v1/compliance/activities`) with cursor-based pagination.
   - Extracts timestamps, actor identities, action types, workspaces, and IP addresses.
2. **Admin API Resource Inventory**:
   - Ingests organization members, workspace definitions, API keys, and workspace assignments.
3. **Resilience & Rate Limiting**:
   - Exponential backoff on HTTP 429 status codes.
   - Network failure retries with configurable jitter.
4. **Data Isolation & Snapshots**:
   - Output structured JSON snapshots to `data/snapshots/`.
   - Never commit production snapshots to git.

---

## 🛠️ Commands & Verification

```bash
# Collect audit events
pnpm collect:audit

# Collect organization usage and seat data
pnpm collect:usage

# Run complete collection pipeline
pnpm collect
```
