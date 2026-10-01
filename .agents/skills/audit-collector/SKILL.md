---
name: audit-collector
description: Develop, test and run collection from the Claude Enterprise APIs (Compliance, Admin user management, Enterprise Analytics, Spend Limits) — pagination, retries, Activity Feed windows, dataset coverage, snapshots and the synthetic demo tenant.
---

# 📡 Claude Audit Collector Skill (`audit-collector`)

Use this skill when developing, testing, or executing data collection against Claude Enterprise.

---

## 🎯 Scope & Capabilities

1. **Datasets** (13): organizations, members, memberActivity, invites, groups, settings, credentials, credentialUsage (projection), activities, usage, cost, adoption, spendLimits — see `docs/BLUEPRINT.md` §5.2 and `docs/API-MAPPING.md`.
2. **Activity Feed**: window polling (`created_at.gte/lt`, `order=asc`, 2-minute lag, 10-minute overlap) with ID de-duplication; `after_id` pages within the window. Never page "forward" with `after_id` from the newest event (it returns older events).
3. **Resilience**: retries in `HttpClient` (429 `retry-after`; 500/502/503/504/529 exponential back-off up to 60 s; `x-should-retry: false` stops). Analytics 410 restarts the cursor once.
4. **Coverage**: throw `DataUnavailableError` for missing keys, 401/403/404; other failures mark the dataset `error`. One failing dataset never stops the others.
5. **Data isolation**: snapshots go to `data/` (gitignored) and the `data/audit` branch only.

---

## 🛠️ Commands & Verification

```bash
pnpm demo                 # synthetic tenant → data/sample/ (no key; deterministic)
pnpm collect              # live snapshot (needs ANTHROPIC_ENTERPRISE_API_KEY in .env or the environment)
pnpm pipeline             # collect → check → data/dashboard.json
pnpm archive --days 365   # gzip snapshots older than the retention period

# Tests (fake Anthropic server, schema/mapping, retries, pagination, windows)
pnpm --filter @claude-audit/collector test
```

After `pnpm collect`, read the `Snapshot …: N/13 datasets collected` line and each `unavailable` / `error` reason before changing code: most gaps are missing scopes, not bugs.
