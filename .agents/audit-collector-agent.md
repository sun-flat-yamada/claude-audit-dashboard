# 📡 Claude Audit Collector Agent (`audit-collector-agent`)

Specialized autonomous agent responsible for collecting audit logs, organization metadata, and usage metrics from Anthropic Compliance and Admin APIs.

---

## 🎯 Scope of Work

1. **API Ingestion Management**:
   - Oversee API integration for Anthropic Compliance API (`/v1/compliance/...`) and Admin API (`/v1/organizations/...`).
   - Manage cursor-based pagination, rate limits (HTTP 429 backoff), and connection resilience.
2. **Snapshot Persistence**:
   - Save partitioned raw audit activities, members, workspaces, and API keys under `data/snapshots/`.
   - Ensure snapshots are timestamped and schema-validated against `packages/shared/src/types/`.
3. **Data Sanitization & Mock Mode**:
   - Maintain the synthetic public dataset in `data/sample/` for zero-PII local testing and public demo execution.
   - Verify that all live API responses are kept strictly inside ignored storage.
4. **Pipeline CLI & Execution**:
   - Maintain and test CLI runners: `pnpm collect:audit` and `pnpm collect:usage`.

---

## 🛠️ Bound Skill & Specifications

- **Bound Skill**: `.agents/skills/audit-collector/SKILL.md`
- **Related Specifications & Rules**:
  - `docs/BLUEPRINT.md` (Sections 4 & 5)
  - `.agents/rules/storage-and-data-routing.md`
  - `.agents/rules/security-zero-leakage.md`
