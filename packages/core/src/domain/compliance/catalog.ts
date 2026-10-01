import { z } from 'zod';
import type { Rule } from './define-rule.js';
import {
  activityWatchRule,
  activityWatchSchema,
  type ActivityWatch,
} from './factories/activity-watch.js';
import { DEFAULT_ACTIVITY_WATCHES, DEFAULT_SETTING_BASELINES } from './factories/defaults.js';
import {
  settingBaselineRule,
  settingBaselineSchema,
  type SettingBaseline,
} from './factories/setting-baseline.js';
import { BUILTIN_RULES } from './rules/index.js';

/** Shape of `config/custom-rules.json`: data-driven rules added without code. */
export const customRulesSchema = z.object({
  settingBaselines: z.array(settingBaselineSchema).default([]),
  activityWatches: z.array(activityWatchSchema).default([]),
});

export type CustomRules = z.input<typeof customRulesSchema>;

/** Custom definitions replace defaults with the same id and add the rest. */
const mergeById = <T extends { id: string }>(defaults: readonly T[], custom: readonly T[]): T[] => [
  ...new Map([...defaults, ...custom].map((def) => [def.id, def])).values(),
];

export interface RuleCatalog {
  rules: Rule[];
  settingBaselines: SettingBaseline[];
  activityWatches: ActivityWatch[];
}

/** Every rule the engine evaluates: code rules, then settings baselines, then activity watches. */
export function buildRuleCatalog(custom: CustomRules = {}): RuleCatalog {
  const parsed = customRulesSchema.parse(custom);
  const settingBaselines = mergeById(DEFAULT_SETTING_BASELINES, parsed.settingBaselines);
  const activityWatches = mergeById(DEFAULT_ACTIVITY_WATCHES, parsed.activityWatches);
  const rules = [
    ...BUILTIN_RULES,
    ...settingBaselines.map(settingBaselineRule),
    ...activityWatches.map(activityWatchRule),
  ];
  const duplicate = rules.map((r) => r.meta.id).find((id, i, ids) => ids.indexOf(id) !== i);
  if (duplicate) throw new Error(`Duplicate rule id: ${duplicate}`);
  return { rules, settingBaselines, activityWatches };
}
