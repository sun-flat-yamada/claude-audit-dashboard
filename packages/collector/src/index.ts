/**
 * @claude-audit/collector — entry point.
 *
 * Phase 2 (see docs/BLUEPRINT.md §17) will implement the API clients,
 * collectors, compliance checkers and notifiers under src/. Until then this
 * entry point only reports the loaded rule catalogue so the package builds
 * and the monorepo pipeline can be exercised end to end.
 */
import { pathToFileURL } from 'node:url';
import { DEFAULT_AUDIT_RULES } from '@claude-audit/shared';

export function describeCollector(): string {
  return `claude-audit collector (not yet implemented) — ${DEFAULT_AUDIT_RULES.length} built-in rules defined`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(describeCollector());
}
