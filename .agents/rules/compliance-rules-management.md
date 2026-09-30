# Compliance Rules Management

## Rule Synchronization Policy

When compliance rules are added, updated, or removed, the following files MUST be updated in sync:

1. **Rule Definition** — `packages/shared/src/constants/audit-rules.ts`
2. **Type Definition** — `packages/shared/src/types/compliance.ts`
3. **Checker Implementation** — `packages/collector/src/checkers/<category>.ts`
4. **Checker Tests** — `packages/collector/src/checkers/__tests__/<category>.test.ts`
5. **Blueprint Documentation** — `docs/BLUEPRINT.md` (Section 6: Compliance Audit Rules)
6. **README Rule Table** — `README.md`
7. **Sample Data** — `data/sample/dashboard.json` (if demo results need updating)

## Rule ID Convention

| Prefix | Category | Examples |
|--------|----------|----------|
| AC-xxx | Access Control | AC-001, AC-002 |
| AK-xxx | API Key Management | AK-001, AK-002 |
| UA-xxx | Usage Anomaly | UA-001, UA-002 |
| DG-xxx | Data Governance | DG-001, DG-002 |
| OP-xxx | Operational | OP-001, OP-002 |
| BL-xxx | Billing | BL-001, BL-002 |

## Adding a Custom Rule

1. Define in `config/custom-rules.json`
2. Implement checker function
3. Register in the plugin registry
4. No core code changes required
