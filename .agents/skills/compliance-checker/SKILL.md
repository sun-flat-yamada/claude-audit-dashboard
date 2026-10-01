---
name: compliance-checker
description: Evaluate the 30 built-in compliance rules (plus custom CF/AM rules) against the latest snapshot, explain skipped results through dataset coverage, tune thresholds, and add or change rules while keeping docs in sync.
---

# 🔍 Compliance Checker Skill (`compliance-checker`)

Use this skill when auditing compliance results, implementing or changing rules, tuning thresholds, or validating scoring.

---

## 📋 Where things are

| What                         | Where                                                                                   |
| :--------------------------- | :-------------------------------------------------------------------------------------- |
| Rule list (normative)        | `docs/BLUEPRINT.md` §7.1 (30 rules: AC, AK, UA, DG, OP, CF, AM)                         |
| Code rules                   | `packages/core/src/domain/compliance/rules/<category>.ts`                               |
| Baselines and watches (data) | `packages/core/src/domain/compliance/factories/defaults.ts`, `config/custom-rules.json` |
| Engine, scoring              | `packages/core/src/domain/compliance/engine.ts`, `scoring.ts`                           |
| Thresholds / disabled rules  | `config/default.json` → `compliance.params.<ID>`, `compliance.disabledRules`            |

## 🛠️ Execution & diagnostics

```bash
pnpm demo               # whole pipeline on the synthetic tenant (no key needed); output in data/sample/
pnpm check:compliance   # evaluate the latest stored snapshot (after `pnpm collect`)
pnpm report:compliance  # Markdown / HTML / CSV / JSON in data/reports/compliance/
```

Output: `data/reports/compliance/<snapshot id>.json` (one report per evaluated snapshot).

## 🧭 Reading results

- `skipped` means a required dataset was not collected; the message names the dataset and the reason (missing key or scope, API error). Check the snapshot coverage or the dashboard's Data coverage section, not the rule.
- `error` means invalid parameters (`Invalid params: …`) or an exception inside the rule; other rules still ran.
- The score is `100 − Σ weights of failed rules`; it is always reported with `N of M rules assessed` when anything was skipped or errored.

## ✅ Changing rules

Follow `.agents/rules/compliance-rules-management.md`: implementation + tests + BLUEPRINT §7.1 + README.md + README.ja.md + `pnpm demo` in the same change. The docs-sync and golden tests in `packages/collector/src/main/__tests__/sample-and-docs.test.ts` enforce it.
