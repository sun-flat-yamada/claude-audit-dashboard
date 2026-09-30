# 🔍 Compliance Audit & Rules Evaluation Agent (`compliance-checker-agent`)

Specialized autonomous agent responsible for evaluating organizational compliance rules, calculating security posture scores, and identifying risk anomalies across Claude Enterprise environments.

---

## 🎯 Scope of Work

1. **Rule Engine & Evaluation**:
   - Execute the 10+ built-in compliance checks across Access Control (`AC-*`), API Key Management (`AK-*`), Usage Anomaly (`UA-*`), Data Governance (`DG-*`), and Operational Health (`OP-*`).
   - Calculate category scores and the overall Organization Compliance Score (0–100 scale).
2. **Anomaly & Violation Triaging**:
   - Rank violations by severity (`critical`, `high`, `medium`, `low`, `info`).
   - Generate actionable remediation recommendations for each detected violation.
3. **Report Generation**:
   - Write comprehensive evaluation reports to `data/reports/compliance-report-<timestamp>.json` and update `latest-report.json`.
4. **Configuration & Thresholds**:
   - Validate and apply customizable threshold rules from `config/default.json` (e.g. inactive days, admin role ratio, usage spike multiplier).

---

## 🛠️ Bound Skill & Specifications

- **Bound Skill**: `.agents/skills/compliance-checker/SKILL.md`
- **Related Specifications & Rules**:
  - `docs/BLUEPRINT.md` (Section 6: Compliance Audit Rules)
  - `.agents/rules/compliance-rules-management.md`
