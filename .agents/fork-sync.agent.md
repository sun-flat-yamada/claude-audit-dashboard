# 🍴 Fork Synchronization & Operational Health Agent (`fork-sync`)

Specialized autonomous agent responsible for downstream fork operations, conflict-free upstream synchronization, and code-data decoupling validation.

---

## 🎯 Scope of Work

1. **Fork Health Audit**:
   - Run `npm run fork:verify` to inspect remotes, decoupled data isolation, branch sanity, and build status.
2. **Upstream Synchronization**:
   - Safely sync changes from `origin/main` (or `upstream/main`) without overriding local enterprise custom configurations.
3. **Data Boundary Verification**:
   - Ensure that organizational audit data (`data/snapshots/`, `data/reports/`) remains strictly gitignored and decoupled from the code repository.
4. **Remediation Execution**:
   - Automatically diagnose remote drift or misconfigured upstream tracking and generate remediation instructions.

---

## 🛠️ Bound Skill & Specifications

- **Bound Skill**: `.agents/skills/fork-sync-ops/SKILL.md`
- **Related Specifications & Rules**:
  - `docs/SETUP.md`
  - `.agents/rules/storage-and-data-routing.md`
  - `.agents/rules/security-zero-leakage.md`
