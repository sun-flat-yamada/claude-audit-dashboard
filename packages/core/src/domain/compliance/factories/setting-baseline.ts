import { z } from 'zod';
import { defineRule, type Rule } from '../define-rule.js';
import { SEVERITIES, failIfAny, skip } from '../types.js';

/** How an effective setting value is compared. Add a kind here and a check in CHECKS. */
const expectationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('equals'), value: z.union([z.boolean(), z.number(), z.string()]) }),
  z.object({ kind: z.literal('oneOf'), values: z.array(z.string()).min(1) }),
  z.object({ kind: z.literal('max'), value: z.number() }),
  z.object({ kind: z.literal('nonEmpty') }),
  z.object({ kind: z.literal('retentionAtMostDays'), days: z.number().int().positive() }),
]);

export type Expectation = z.infer<typeof expectationSchema>;

type Check<K extends Expectation['kind']> = (
  value: unknown,
  expect: Extract<Expectation, { kind: K }>,
) => boolean;

const retentionDays = z.object({
  type: z.literal('fixed'),
  duration: z.number(),
  timescale: z.enum(['day', 'month']),
});

/** Every configured data type must use a fixed window no longer than `days` (a month = 30 days). */
const retentionWithin = (value: unknown, days: number): boolean => {
  if (typeof value !== 'object' || value === null) return false;
  const periods = Object.values(value);
  return (
    periods.length > 0 &&
    periods.every((period) => {
      const fixed = retentionDays.safeParse(period);
      if (!fixed.success) return false;
      const { duration, timescale } = fixed.data;
      return duration * (timescale === 'month' ? 30 : 1) <= days;
    })
  );
};

const CHECKS: { [K in Expectation['kind']]: Check<K> } = {
  equals: (value, e) => value === e.value,
  oneOf: (value, e) => typeof value === 'string' && e.values.includes(value),
  max: (value, e) => typeof value === 'number' && value <= e.value,
  nonEmpty: (value) => Array.isArray(value) && value.length > 0,
  retentionAtMostDays: (value, e) => retentionWithin(value, e.days),
};

export const satisfies = (value: unknown, expect: Expectation): boolean =>
  (CHECKS[expect.kind] as Check<Expectation['kind']>)(value, expect);

type Describe<K extends Expectation['kind']> = (
  expect: Extract<Expectation, { kind: K }>,
) => string;

const DESCRIPTIONS: { [K in Expectation['kind']]: Describe<K> } = {
  equals: (e) => `= ${JSON.stringify(e.value)}`,
  oneOf: (e) => `in [${e.values.join(', ')}]`,
  max: (e) => `<= ${e.value}`,
  nonEmpty: () => 'is not empty',
  retentionAtMostDays: (e) => `<= ${e.days} days`,
};

export const describeExpectation = (expect: Expectation): string =>
  (DESCRIPTIONS[expect.kind] as Describe<Expectation['kind']>)(expect);

export const settingBaselineSchema = z.object({
  id: z.string().regex(/^[A-Z]{2,}-\d{3}$/),
  name: z.string().min(1),
  severity: z.enum(SEVERITIES),
  setting: z.string().min(1),
  expect: expectationSchema,
  description: z.string().optional(),
  remediation: z.string().optional(),
});

export type SettingBaseline = z.infer<typeof settingBaselineSchema>;

/** Builds a configuration rule comparing one effective organization setting to a baseline. */
export function settingBaselineRule(def: SettingBaseline): Rule {
  return defineRule({
    meta: {
      id: def.id,
      name: def.name,
      category: 'configuration',
      severity: def.severity,
      description:
        def.description ?? `Effective setting ${def.setting} ${describeExpectation(def.expect)}`,
      remediation: def.remediation ?? `Change ${def.setting} in claude.ai organization settings.`,
    },
    requires: ['settings'],
    params: z.object({}),
    evaluate({ data }) {
      const rows = data.settings.flatMap((org) => {
        const setting = org.values[def.setting];
        return setting ? [{ org, value: setting.value }] : [];
      });
      if (rows.length === 0) {
        return skip(`${def.setting} is not controllable in any organization`);
      }
      return failIfAny(
        rows.filter((row) => !satisfies(row.value, def.expect)),
        {
          pass: `${rows.length} organization(s) meet ${def.setting} ${describeExpectation(def.expect)}`,
          fail: (n) => `${n} of ${rows.length} organization(s) deviate on ${def.setting}`,
        },
        (row) => ({
          kind: 'setting',
          id: row.org.organizationId,
          label: `${row.org.organizationName}: ${def.setting} = ${JSON.stringify(row.value)}`,
        }),
      );
    },
  });
}
