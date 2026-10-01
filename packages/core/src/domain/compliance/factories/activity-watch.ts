import { z } from 'zod';
import type { Activity } from '../../model/entities.js';
import { countBy } from '../../util/collections.js';
import { defineRule, type Rule } from '../define-rule.js';
import { SEVERITIES, pass, warn } from '../types.js';
import { KNOWN_ACTIVITY_TYPES } from './known-activity-types.js';

const matcherSchema = z.object({
  types: z.array(z.string()).min(1),
  /** Optional attribute filter, e.g. `current_role` in the administrative roles. */
  where: z.object({ attribute: z.string(), in: z.array(z.string()).min(1) }).optional(),
});

export const activityWatchSchema = z.object({
  id: z.string().regex(/^[A-Z]{2,}-\d{3}$/),
  name: z.string().min(1),
  severity: z.enum(SEVERITIES),
  match: z.array(matcherSchema).min(1),
  threshold: z.number().int().positive().default(1),
  description: z.string().optional(),
  remediation: z.string().optional(),
});

export type ActivityWatch = z.input<typeof activityWatchSchema>;
type Matcher = z.infer<typeof matcherSchema>;

const matches = (activity: Activity, matcher: Matcher): boolean =>
  matcher.types.includes(activity.type) &&
  (!matcher.where ||
    matcher.where.in.includes(String(activity.attributes[matcher.where.attribute])));

/** Activity types referenced by watches that the API reference does not list. */
export const unknownActivityTypes = (watches: readonly ActivityWatch[]): string[] =>
  [...new Set(watches.flatMap((w) => w.match.flatMap((m) => m.types)))].filter(
    (type) => !KNOWN_ACTIVITY_TYPES.has(type),
  );

const MAX_EVIDENCE = 50;

/** Builds a rule that flags matching activities recorded since the previous collection. */
export function activityWatchRule(input: ActivityWatch): Rule {
  const def = activityWatchSchema.parse(input);
  const types = [...new Set(def.match.flatMap((m) => m.types))];
  return defineRule({
    meta: {
      id: def.id,
      name: def.name,
      category: 'activity-monitoring',
      severity: def.severity,
      description: def.description ?? `Activity Feed events: ${types.join(', ')}`,
      remediation: def.remediation ?? 'Confirm each event with its actor and your change records.',
    },
    requires: ['activities'],
    params: z.object({ threshold: z.number().int().positive().default(def.threshold) }),
    evaluate({ data, params }) {
      const hits = data.activities.filter((a) => def.match.some((m) => matches(a, m)));
      const message = `${hits.length} matching event(s) since the previous collection`;
      if (hits.length < params.threshold) return pass(message);
      return warn(message, {
        details: { count: hits.length, byType: Object.fromEntries(countBy(hits, (a) => a.type)) },
        evidence: hits.slice(0, MAX_EVIDENCE).map((a) => ({
          kind: 'activity',
          id: a.id,
          label: `${a.createdAt} ${a.type} by ${a.actor.email ?? a.actor.id ?? a.actor.kind}`,
        })),
      });
    },
  });
}
