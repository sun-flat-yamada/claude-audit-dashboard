import { NOW } from '../../../__tests__/fixtures.js';
import type { AuditSnapshot } from '../../model/snapshot.js';
import type { Rule } from '../define-rule.js';
import { evaluateCompliance } from '../engine.js';
import type { CheckResult } from '../types.js';

/** Evaluates a single rule and returns its result. */
export function evaluate(
  rule: Rule,
  snap: AuditSnapshot,
  params: Record<string, unknown> = {},
  now: Date = NOW,
): CheckResult {
  const [result] = evaluateCompliance([rule], snap, {
    now,
    params: { [rule.meta.id]: params },
  }).results;
  if (!result) throw new Error('rule produced no result');
  return result;
}
