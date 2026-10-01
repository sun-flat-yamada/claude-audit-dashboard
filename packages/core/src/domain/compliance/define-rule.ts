import type { z } from 'zod';
import type { Coverage, DatasetMap, DatasetName } from '../model/dataset.js';
import type { SnapshotHeader } from '../model/snapshot.js';
import type { Outcome, RuleMeta } from './types.js';

export interface RuleInput<P> {
  /** Every dataset; the ones listed in `requires` are guaranteed to have been collected. */
  data: DatasetMap;
  coverage: Coverage;
  snapshot: SnapshotHeader;
  params: P;
  now: Date;
}

/**
 * A compliance rule: metadata, the datasets it needs, a zod schema for its parameters
 * (defaults included) and a pure evaluation function. Rules never perform I/O.
 */
export interface Rule<S extends z.ZodType = z.ZodType> {
  readonly meta: RuleMeta;
  readonly requires: readonly DatasetName[];
  readonly params: S;
  evaluate(input: RuleInput<z.output<S>>): Outcome;
}

/** Typed helper: infers the parameter type from the schema, returns the erased rule. */
export const defineRule = <S extends z.ZodType>(rule: Rule<S>): Rule => rule as unknown as Rule;
