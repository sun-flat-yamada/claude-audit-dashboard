# Extension Architecture — adding sources, rules, analyses, reports and channels

> **Goal:** API changes and new audits, analyses, reports or channels are absorbed by **adding one implementation and registering it**. No `switch` on kinds, no edits to orchestration code, no growth in the complexity of existing functions.
>
> Structure and layering: [ARCHITECTURE.md](ARCHITECTURE.md). Normative rule list: [BLUEPRINT §7](BLUEPRINT.md#7-コンプライアンス監査ルール).

---

## Principles

1. **Ports in the core, implementations outside.** `@claude-audit/core` defines the interfaces (pure TypeScript, no I/O); `@claude-audit/collector` implements the ones that touch the outside world.
2. **Declare data needs.** Rules, analyzers and projections list the datasets they `require`. The engine checks collection coverage first, so an implementation never has to handle "the API was not reachable".
3. **Validate at the boundary.** API responses, configuration and rule parameters are parsed with zod; failures become precise messages (`error` results, `unavailable` datasets, startup errors) instead of silent defaults.
4. **One registry per extension point.** `Registry<T>` (ordered, rejects duplicates, helpful "unknown X" errors) or a `BUILTIN_*` array.
5. **Data before code.** Configuration baselines and activity watches are data definitions turned into rules by factories.

---

## Extension points

| #   | Extension              | Interface (package)                | Register in                                                            |
| --- | ---------------------- | ---------------------------------- | ---------------------------------------------------------------------- |
| 1   | Data source            | `DatasetCollector` (core port)     | `collector/src/adapters/anthropic/collectors.ts`                       |
| 2   | Derived dataset        | `Projection` (core)                | `BUILTIN_PROJECTIONS` in `core/src/domain/projections/index.ts`        |
| 3   | Compliance rule (code) | `defineRule` → `Rule` (core)       | the category array in `core/src/domain/compliance/rules/<category>.ts` |
| 4   | Rule from data         | setting baseline / activity watch  | `config/custom-rules.json` (or `factories/defaults.ts`)                |
| 5   | Baseline expectation   | entry in `CHECKS` + `DESCRIPTIONS` | `core/src/domain/compliance/factories/setting-baseline.ts`             |
| 6   | Analysis               | `Analyzer` (core)                  | `BUILTIN_ANALYZERS` in `core/src/domain/analysis/analyzers.ts`         |
| 7   | Report                 | `ReportDefinition` (core)          | `BUILTIN_REPORTS` in `core/src/application/use-cases/reports.ts`       |
| 8   | Output format          | `DocumentRenderer` (core port)     | `BUILTIN_RENDERERS` in `collector/src/adapters/renderers/index.ts`     |
| 9   | Notification channel   | `Notifier` (core port)             | `notifiers()` in `collector/src/main/container.ts`                     |
| 10  | CLI command            | `Command` (collector)              | `COMMANDS` in `collector/src/main/commands.ts`                         |

---

## 1. Data source

```ts
export interface DatasetCollector<K extends DatasetName = DatasetName> {
  readonly dataset: K;
  readonly source: string; // e.g. 'GET /v1/organizations/users'
  collect(context: { now: Date; range: DateRange; cursor: unknown }): Promise<{
    items: DatasetMap[K];
    cursor?: unknown; // persisted and handed back next run
    source?: string; // endpoint that actually served the data (fallback chains)
    window?: TimeWindow;
    asOf?: string;
  }>;
}
```

- Throw `DataUnavailableError` for "not here" (missing key, 401/403/404, feature disabled): the dataset becomes `unavailable`, other datasets continue, rule OP-002 reports it.
- Any other error marks the dataset `error`.
- A **new dataset** needs one line in `DatasetMap` (`core/src/domain/model/dataset.ts`), a gateway method with a lenient zod schema and a mapper, and the collector registration. Consumers declare `requires: ['newDataset']`.
- An **API change** (renamed field, new pagination, version bump) stays inside the gateway's schema, mapper or paginator choice.

## 2. Derived dataset (projection)

```ts
export interface Projection<K extends DatasetName = DatasetName> {
  readonly dataset: K;
  readonly requires: readonly DatasetName[];
  reduce(input: { previous: unknown; data: DatasetMap; now: Date }): {
    state: unknown; // stored in state.json, handed back as `previous`
    items: DatasetMap[K];
    window: TimeWindow;
  };
}
```

Example: `credentialUsage` accumulates the last time each key appeared as an `api_actor` in the Activity Feed, which no single API call provides.

## 3. Compliance rule (code)

```ts
export const stalePendingInvites = defineRule({
  meta: {
    id: 'AC-004',
    name: 'Stale Pending Invites',
    category: 'access-control',
    severity: 'low',
    description: 'Invitations pending longer than the threshold (they hold seats and grant access)',
    remediation: 'Withdraw invitations that are no longer needed.',
  },
  requires: ['invites'],
  params: z.object({ maxPendingDays: z.number().int().positive().default(30) }),
  evaluate({ data, params, now }) {
    return failIfAny(
      data.invites.filter(
        (i) => i.status === 'pending' && daysBetween(i.invitedAt, now) > params.maxPendingDays,
      ),
      {
        pass: 'No stale pending invites',
        fail: (n) => `${n} invite(s) pending for more than ${params.maxPendingDays} days`,
      },
      (i) => ({
        kind: 'invite',
        id: i.id,
        label: `${i.email} (invited ${i.invitedAt.slice(0, 10)})`,
      }),
    );
  },
});
```

The engine (not the rule) handles: disabled rules, missing datasets (`skipped` with the reason), parameter validation (`compliance.params.<ID>` merged over the schema defaults; invalid → `error`), and exceptions (→ `error`, other rules continue). Outcome helpers: `pass`, `fail`, `warn`, `skip`, `failIfAny`.

Checklist: tests for pass / fail / skipped next to the category file; one row in `docs/BLUEPRINT.md` §7.1, `README.md` and `README.ja.md` (a test enforces that the tables match the catalog).

## 4. Rule from data (no code)

`config/custom-rules.json` — validated at startup; an `id` equal to a built-in definition overrides it.

```json
{
  "settingBaselines": [
    {
      "id": "CF-101",
      "name": "Web Search Disabled",
      "severity": "low",
      "setting": "web_search_enabled",
      "expect": { "kind": "equals", "value": false }
    }
  ],
  "activityWatches": [
    {
      "id": "AM-101",
      "name": "Organization Deletion",
      "severity": "high",
      "match": [{ "types": ["org_deletion_requested"] }],
      "threshold": 1
    }
  ]
}
```

- **Setting baseline** → category `configuration`, requires `settings`. Evaluates only organizations that report the setting; `skipped` when no organization can change it.
- **Activity watch** → category `activity-monitoring`, requires `activities`. `warning` when the matches since the previous collection reach `threshold`; matching events become evidence. Unknown activity types are reported at startup (`KNOWN_ACTIVITY_TYPES`, 516 types as of 2026-09-30).

## 5. Baseline expectation

Expectation kinds today: `equals`, `oneOf`, `max`, `nonEmpty`, `retentionAtMostDays`. A new kind is one schema variant plus one entry in `CHECKS` (the comparison) and `DESCRIPTIONS` (the human-readable form); the mapped types make a missing entry a compile error.

## 6. Analysis

```ts
export interface Analyzer {
  readonly id: string;
  readonly requires: readonly DatasetName[];
  analyze(data: DatasetMap): Insight[]; // { id, kind, priority, title, detail, metrics }
}
```

Insights appear on the dashboard and in the weekly and monthly reports. Analyzers whose datasets are missing are skipped.

## 7. Report

```ts
export interface ReportDefinition {
  readonly id: string; // CLI: pnpm cli report <id>
  readonly description: string;
  readonly liveDatasets: readonly DatasetName[]; // re-collected for the period; [] = stored snapshots
  period(now: Date, argument?: string): DateRange;
  build(context: ReportContext): ReportDocument;
}
```

A report returns a format-neutral `ReportDocument` made of `kpis`, `table`, `list` and `text` sections, so every renderer and notifier supports it without changes.

## 8. Output format

```ts
export interface DocumentRenderer {
  readonly id: string;
  render(document: ReportDocument): { suffix: string; mediaType: string; content: string }[];
}
```

Built in: Markdown, HTML (escaped, self-contained), CSV (one file per table), JSON.

## 9. Notification channel

```ts
export interface Notifier {
  readonly id: string;
  send(alert: AlertMessage): Promise<void>; // { key, title, severity, lines, link?, document? }
}
```

Built in: console, Slack, Discord, e-mail. A channel is registered only when its secrets are present. Failures of one channel do not stop the others (`dispatchAlert` reports which ones failed). Which results are sent, and how often, is decided once in `planComplianceAlert` (status filter, minimum severity, cooldown).

## 10. CLI command

```ts
export interface Command {
  readonly name: string;
  readonly usage: string;
  readonly description: string;
  run(container: Container, args: readonly string[]): Promise<void>;
}
```

Commands receive the composed `Container` (configuration, repositories, collectors, registries) and stay thin: they call use cases and log.

---

## What does not change when you extend

| You add…                      | Unchanged                                                                |
| ----------------------------- | ------------------------------------------------------------------------ |
| a rule or a custom rule       | engine, scoring, reports, notifications, dashboard (results are generic) |
| a dataset                     | snapshot storage, coverage, OP-002, archive (all iterate datasets)       |
| an analyzer                   | dashboard and reports (insights are generic)                             |
| a report                      | renderers, notifiers, CLI (`report <id>`)                                |
| a renderer or channel         | reports and alert planning                                               |
| an API field / version change | everything outside the gateway's schema and mapper                       |
