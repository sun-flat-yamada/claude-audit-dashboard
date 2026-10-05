import {
  OPTIONAL_SOURCES,
  type ConfigViewInput,
  type OptionalDatasetName,
} from '@claude-audit/core';
import type { Container } from './container.js';

/** Optional datasets whose source flag is on (and that are not listed in `sources.disabled`). */
export const enabledOptionalDatasets = (c: Container): OptionalDatasetName[] =>
  (Object.keys(OPTIONAL_SOURCES) as OptionalDatasetName[]).filter(
    (name) =>
      c.config.sources[OPTIONAL_SOURCES[name]].enabled && !c.config.sources.disabled.includes(name),
  );

/**
 * Maps the loaded configuration to the allowlisted presenter input. Only named, non-secret
 * fields are copied: channels become booleans (the webhook URLs, SMTP settings and recipients
 * stay in the environment object and are never passed on), and no path is read.
 */
export function configViewInput(c: Container): Omit<ConfigViewInput, 'now'> {
  const { sources, compliance, notifications, retention, dashboard } = c.config;
  return {
    rules: c.rules,
    customRules: c.customRules,
    disabledRules: compliance.disabledRules,
    ruleParams: compliance.params,
    disabledDatasets: sources.disabled,
    enabledOptionalDatasets: enabledOptionalDatasets(c),
    membersProvider: sources.members.provider,
    memberActivityLookbackDays: sources.memberActivity.lookbackDays,
    groupMemberRequestLimit: sources.groups.maxMemberRequests,
    activities: {
      initialLookbackHours: sources.activities.initialLookbackHours,
      overlapMinutes: sources.activities.overlapMinutes,
      lagMinutes: sources.activities.lagMinutes,
      pageSize: sources.activities.pageSize,
      includedTypeCount: sources.activities.includeTypes.length,
      excludedTypeCount: sources.activities.excludeTypes.length,
    },
    notifications: {
      statuses: notifications.statuses,
      minSeverity: notifications.minSeverity,
      cooldownMinutes: notifications.cooldownMinutes,
      channels: {
        slack: Boolean(c.env.slackWebhookUrl),
        discord: Boolean(c.env.discordWebhookUrl),
        email: c.env.smtp !== null,
      },
    },
    snapshotDays: retention.snapshotDays,
    maskPii: dashboard.maskPii,
  };
}
