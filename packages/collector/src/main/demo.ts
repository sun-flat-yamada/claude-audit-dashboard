import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  OPTIONAL_DATASET_NAMES,
  buildRuleCatalog,
  type ArchiveEntry,
  type ConfigViewInput,
  type CustomRules,
  type Logger,
} from '@claude-audit/core';
import { createDemoOptionalCollectors } from '../adapters/demo/demo-optional.js';
import {
  DEMO_NOW,
  createDemoCollectors,
  demoAckStore,
  demoState,
  demoUsageMatrixInput,
} from '../adapters/demo/demo-source.js';
import { toMarkdown } from '../adapters/renderers/markdown.js';
import { FsAckRepository } from '../adapters/storage/ack-store.js';
import { stableStringify } from '../adapters/storage/file-store.js';
import { appConfigSchema } from '../infrastructure/config.js';
import { fixedClock } from '../infrastructure/runtime.js';
import { createContainer, type Container } from './container.js';
import { writeDetail } from './detail.js';
import { writeMonthlyView } from './monthly-report.js';
import { writeFiles } from './write-files.js';
import { check, collect, generateReport, writeDashboard } from './workflows.js';

/**
 * `default`: the committed public sample (`data/sample/`, optional sources off).
 * `optional-sources`: the same tenant with the optional Console and Claude Code datasets on
 * (B4); written to a separate, gitignored directory and checked by `fork:verify` when present.
 */
export type DemoProfile = 'default' | 'optional-sources';

export const DEMO_PROFILES: readonly DemoProfile[] = ['default', 'optional-sources'];

export interface DemoOptions {
  profile?: DemoProfile | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  cwd?: string | undefined;
  logger?: Logger | undefined;
}

/** Months of the public monthly cost data: the report month (previous month) and two before it. */
const DEMO_MONTHS = ['2026-06', '2026-07', '2026-08'] as const;

async function writeDemoMonths(c: Container): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const month of DEMO_MONTHS) {
    const { document } = await generateReport(c, 'monthly', month);
    Object.assign(files, await writeMonthlyView(c, document));
  }
  return files;
}

/** Illustrative custom rules of the public sample (synthetic; not applied to the sample results). */
const DEMO_CUSTOM_RULES: CustomRules = {
  settingBaselines: [
    {
      id: 'CF-010',
      name: 'Web Search Disabled',
      severity: 'low',
      setting: 'web_search_enabled',
      expect: { kind: 'equals', value: false },
    },
  ],
  activityWatches: [
    {
      id: 'AM-008',
      name: 'API Key Creation',
      severity: 'medium',
      match: [{ types: ['api_key_created', 'admin_api_key_created'] }],
      threshold: 2,
    },
  ],
};

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * A synthetic archive for the public sample: snapshots on days 1, 8, 15 and 22 (06:00 UTC) of
 * the covered months of 2023 (Nov-Dec), 2024 (Mar-Dec) and 2025 (Jan-Sep), with deterministic
 * compressed sizes of roughly 1.5 to 2.5 MB, plus one unrelated file that the inventory ignores.
 */
export function demoArchiveEntries(): ArchiveEntry[] {
  const spans: [number, number, number][] = [
    [2023, 11, 12],
    [2024, 3, 12],
    [2025, 1, 9],
  ];
  const entries: ArchiveEntry[] = [];
  for (const [year, from, to] of spans)
    for (let month = from; month <= to; month += 1)
      for (const day of [1, 8, 15, 22]) {
        const id = `${String(year)}-${pad(month)}-${pad(day)}T06-00-00Z`;
        const bytes = 1_500_000 + (((year * 31 + month * 17 + day * 13) * 7919) % 1_000_000);
        entries.push({ dir: String(year), name: `${id}.json.gz`, bytes });
      }
  entries.push({ dir: '2025', name: 'README.txt', bytes: 120 });
  return entries;
}

/**
 * The sample's effective configuration: a disabled rule, an overridden parameter, custom rules
 * and a notification policy with two channels on. It is fixed (never read from the local config
 * or environment) and only illustrates the view, so the other sample files do not change.
 */
function demoConfigInput(profile: DemoProfile): Omit<ConfigViewInput, 'now'> {
  const config = appConfigSchema.parse({
    compliance: {
      disabledRules: ['DG-001'],
      params: { 'OP-001': { maxStaleHours: 48 }, 'UA-002': { monthlyBudget: 10000 } },
    },
    notifications: { statuses: ['fail', 'warning'], minSeverity: 'medium', cooldownMinutes: 240 },
    sources: { disabled: ['adoption'] },
  });
  const { sources, compliance, notifications, retention, dashboard } = config;
  return {
    rules: buildRuleCatalog(DEMO_CUSTOM_RULES).rules,
    customRules: DEMO_CUSTOM_RULES,
    disabledRules: compliance.disabledRules,
    ruleParams: compliance.params,
    disabledDatasets: sources.disabled,
    enabledOptionalDatasets: profile === 'optional-sources' ? OPTIONAL_DATASET_NAMES : [],
    membersProvider: sources.members.provider,
    memberActivityLookbackDays: sources.memberActivity.lookbackDays,
    groupMemberRequestLimit: sources.groups.maxMemberRequests,
    activities: {
      ...sources.activities,
      includedTypeCount: sources.activities.includeTypes.length,
      excludedTypeCount: sources.activities.excludeTypes.length,
    },
    notifications: { ...notifications, channels: { slack: true, discord: false, email: true } },
    snapshotDays: retention.snapshotDays,
    maskPii: dashboard.maskPii,
  };
}

/**
 * Runs collect → check → dashboard → weekly / monthly reports on the synthetic tenant with a
 * fixed clock, then writes the public sample files. Output is deterministic (golden-tested).
 */
export async function writeDemoSample(
  outDir: string,
  options: DemoOptions = {},
): Promise<Record<string, string>> {
  const workDir = await mkdtemp(join(tmpdir(), 'claude-audit-demo-'));
  try {
    const profile = options.profile ?? 'default';
    const c = await createContainer({
      env: options.env,
      cwd: options.cwd,
      logger: options.logger,
      dataDir: workDir,
      clock: fixedClock(DEMO_NOW),
      collectors: [
        ...createDemoCollectors(),
        ...(profile === 'optional-sources' ? createDemoOptionalCollectors() : []),
      ],
      source: 'demo',
    });
    await c.state.save(demoState(DEMO_NOW));
    await new FsAckRepository(c.store).save(demoAckStore(DEMO_NOW));
    await collect(c);
    const { report } = await check(c);
    const view = await writeDashboard(c);
    const weekly = await generateReport(c, 'weekly');
    const monthly = await generateReport(c, 'monthly');
    const monthlyView = await writeDemoMonths(c);
    const detail = await writeDetail(
      c,
      demoConfigInput(profile),
      demoArchiveEntries(),
      demoUsageMatrixInput(DEMO_NOW),
    );
    const files: Record<string, string> = {
      'dashboard.json': stableStringify(view),
      'compliance-report.json': stableStringify(report),
      'weekly-report.md': toMarkdown(weekly.document),
      'monthly-report.md': toMarkdown(monthly.document),
      ...detail,
      ...monthlyView,
    };
    await writeFiles(outDir, files);
    return files;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
