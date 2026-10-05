# 📡 Claude Audit Collector Agent (`audit-collector`)

Specialized autonomous agent responsible for collecting audit logs, directory data, settings, usage, cost and spend limits from the Claude Enterprise APIs.

---

## 🎯 Scope of Work

1. **API Ingestion Management**:
   - Own the Anthropic adapters in `packages/collector/src/adapters/anthropic/`: Compliance API (`/v1/compliance/...`), Admin API user management (`/v1/organizations/users|invites|rbac_groups`), Enterprise Analytics API (`/v1/organizations/analytics/...`) and Spend Limits API.
   - Keep the HTTP contract (429 `retry-after`, 5xx/529 back-off, `x-should-retry`, timeouts) and the four pagination styles in `http-client.ts` / `paginate.ts`.
   - Absorb API changes inside the gateway's zod schema and mapper (`docs/API-MAPPING.md`); never leak API field names into `@claude-audit/core`.
2. **Snapshot Persistence**:
   - Snapshots are `data/snapshots/<id>/<dataset>.json` plus `manifest.json`, with per-dataset coverage (`ok` / `unavailable` / `error` and the reason).
   - The Activity Feed cursor (time window + recent IDs) lives in `data/state.json`; it must never skip or duplicate events.
3. **Data Sanitization & Demo Mode**:
   - Maintain the deterministic synthetic tenant (`packages/collector/src/adapters/demo/`) and regenerate `data/sample/` with `pnpm demo`.
   - Verify that all live API responses stay in gitignored storage or on the `data/audit` branch.
4. **Pipeline CLI & Execution**:
   - Maintain `pnpm collect`, `pnpm pipeline` and `pnpm archive` and their workflow wiring (`collect-audit.yml`).

---

## 🛠️ Bound Skill & Specifications

- **Bound Skill**: `.agents/skills/audit-collector/SKILL.md`
- **Related Specifications & Rules**:
  - `docs/BLUEPRINT.md` (Sections 4–6), `docs/API-MAPPING.md`, `docs/ARCHITECTURE.md`
  - `.agents/rules/storage-and-data-routing.md`
  - `.agents/rules/security-zero-leakage.md`
