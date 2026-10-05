// ─── Domain: model ───────────────────────────────────────────────────────────
export * from './domain/model/entities.js';
export * from './domain/model/dataset.js';
export * from './domain/model/snapshot.js';
export * from './domain/model/metrics.js';
export * from './domain/model/vocabulary.js';

// ─── Domain: compliance ──────────────────────────────────────────────────────
export * from './domain/compliance/types.js';
export * from './domain/compliance/define-rule.js';
export * from './domain/compliance/engine.js';
export * from './domain/compliance/scoring.js';
export * from './domain/compliance/catalog.js';
export { BUILTIN_RULES } from './domain/compliance/rules/index.js';
export * from './domain/compliance/factories/setting-baseline.js';
export * from './domain/compliance/factories/activity-watch.js';
export * from './domain/compliance/factories/defaults.js';
export { KNOWN_ACTIVITY_TYPES } from './domain/compliance/factories/known-activity-types.js';

// ─── Domain: analysis, projections, activity window ─────────────────────────
export * from './domain/analysis/analyzers.js';
export * from './domain/projections/index.js';
export * from './domain/activity-window.js';

// ─── Domain: utilities ───────────────────────────────────────────────────────
export * from './domain/util/time.js';
export * from './domain/util/numbers.js';
export * from './domain/util/collections.js';
export * from './domain/util/mask.js';

// ─── Application ─────────────────────────────────────────────────────────────
export * from './application/ports.js';
export * from './application/registry.js';
export * from './application/state.js';
export * from './application/documents.js';
export * from './application/use-cases/collect-snapshot.js';
export * from './application/use-cases/check-compliance.js';
export * from './application/use-cases/alerts.js';
export * from './application/use-cases/reports.js';
export * from './application/presenters/dashboard-view.js';
export * from './application/presenters/detail-view.js';
export * from './application/presenters/monthly-report-view.js';
export * from './application/presenters/config-view.js';
export * from './application/presenters/archive-view.js';
export * from './application/presenters/alerts-view.js';
export * from './application/alerts-history.js';

// ─── Contracts ───────────────────────────────────────────────────────────────
export * from './contracts/index.js';
