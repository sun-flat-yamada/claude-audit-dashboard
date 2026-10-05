# 🔍 Compliance Audit & Rules Evaluation Agent (`compliance-checker`)

Specialized autonomous agent responsible for evaluating organizational compliance rules, calculating security posture scores, and identifying risk anomalies across Claude Enterprise environments.

---

## 🎯 Scope of Work

1. **Rule Engine & Evaluation**:
   - Evaluate the 30 built-in rules — Access Control (`AC-*`), API Key Management (`AK-*`), Usage Anomaly (`UA-*`), Data Governance (`DG-*`), Operational Health (`OP-*`), Configuration baselines (`CF-*`) and Activity monitoring (`AM-*`) — plus custom rules from `config/custom-rules.json`.
   - Report the overall score (0–100) together with the number of rules actually assessed; explain `skipped` results through dataset coverage.
2. **Anomaly & Violation Triaging**:
   - Rank violations by severity (`critical`, `high`, `medium`, `low`, `info`).
   - Generate actionable remediation recommendations for each detected violation.
3. **Report Generation**:
   - Reports are written to `data/reports/compliance/<snapshot id>.json`; `pnpm report:compliance` renders Markdown / HTML / CSV / JSON.
4. **Configuration & Thresholds**:
   - Tune parameters in `config/default.json` (`compliance.params.<ID>`, e.g. `AC-001.inactiveDays`, `UA-002.monthlyBudget`) and `compliance.disabledRules`; invalid values surface as `error` results.

---

## 🛠️ Bound Skill & Specifications

- **Bound Skill**: `.agents/skills/compliance-checker/SKILL.md`
- **Related Specifications & Rules**:
  - `docs/BLUEPRINT.md` (Section 7: Compliance Audit Rules)
  - `docs/PLUGIN-ARCHITECTURE.md` (adding rules)
  - `.agents/rules/compliance-rules-management.md`
