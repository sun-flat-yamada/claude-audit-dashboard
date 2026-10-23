import type {
  Analyzer,
  ArtifactWriter,
  Clock,
  CustomRules,
  DatasetCollector,
  DocumentRenderer,
  Logger,
  Notifier,
  Projection,
  ReportDefinition,
  Rule,
  SealedMonthSink,
} from '@claude-audit/core';
import {
  BUILTIN_ANALYZERS,
  BUILTIN_PROJECTIONS,
  BUILTIN_REPORTS,
  Registry,
  buildRuleCatalog,
  unknownActivityTypes,
} from '@claude-audit/core';
import { AdminApi } from '../adapters/anthropic/admin-api.js';
import { AnalyticsApi } from '../adapters/anthropic/analytics-api.js';
import {
  BACKFILL_MIN_INTERVAL_MS,
  createBackfillSources,
  type BackfillDefinition,
} from '../adapters/anthropic/backfill-sources.js';
import { createAnthropicCollectors, type AnthropicApis } from '../adapters/anthropic/collectors.js';
import { ClaudeCodeApi } from '../adapters/anthropic/claude-code-api.js';
import { ComplianceApi } from '../adapters/anthropic/compliance-api.js';
import { ConsoleAdminApi } from '../adapters/anthropic/console-admin-api.js';
import { HttpClient } from '../adapters/anthropic/http-client.js';
import { FeatureUsageApi } from '../adapters/anthropic/feature-usage-api.js';
import {
  MEMBER_DAILY_MIN_INTERVAL_MS,
  MemberDailyActivityApi,
} from '../adapters/anthropic/member-daily-api.js';
import { createOptionalCollectors } from '../adapters/anthropic/optional-collectors.js';
import {
  FileRawCapture,
  resolveCaptureDir,
  type RawCapture,
} from '../adapters/anthropic/raw-capture.js';
import { consoleNotifier, discordNotifier, slackNotifier } from '../adapters/notifiers/channels.js';
import { emailNotifier } from '../adapters/notifiers/email.js';
import { BUILTIN_RENDERERS } from '../adapters/renderers/index.js';
import { FileStore } from '../adapters/storage/file-store.js';
import { ledgerHealthCollector } from '../adapters/storage/ledger-status.js';
import {
  FsComplianceReportRepository,
  FsSnapshotRepository,
  FsStateRepository,
  fileArtifacts,
} from '../adapters/storage/repositories.js';
import { disabledDatasets, loadConfig, type AppConfig } from '../infrastructure/config.js';
import { readEnvironment, type Environment } from '../infrastructure/env.js';
import { consoleLogger, systemClock } from '../infrastructure/runtime.js';
import type { MatrixSource } from './usage-matrix.js';

/** Everything a command needs, wired once. The only place that knows concrete classes. */
export interface Container {
  env: Environment;
  config: AppConfig;
  /** `config/custom-rules.json` as loaded (data-driven rules added or replaced by the operator). */
  customRules: CustomRules;
  source: 'live' | 'demo';
  clock: Clock;
  logger: Logger;
  store: FileStore;
  snapshots: FsSnapshotRepository;
  reports: FsComplianceReportRepository;
  state: FsStateRepository;
  artifacts: ArtifactWriter;
  collectors: DatasetCollector[];
  /** Optional model x group collection (F-010); null when off or without an Analytics key. */
  matrix: MatrixSource | null;
  /** Datasets `ledger backfill` can fetch, over paced clients per API family (#159). */
  backfill: Registry<BackfillDefinition>;
  /** Receivers of a freshly sealed ledger month (U7 adds external storage; none yet). */
  sealSinks: readonly SealedMonthSink[];
  projections: readonly Projection[];
  rules: Rule[];
  analyzers: readonly Analyzer[];
  reportDefinitions: Registry<ReportDefinition>;
  renderers: readonly DocumentRenderer[];
  notifiers: Notifier[];
}

export interface ContainerOptions {
  env?: NodeJS.ProcessEnv | undefined;
  cwd?: string | undefined;
  dataDir?: string | undefined;
  clock?: Clock | undefined;
  logger?: Logger | undefined;
  fetchImpl?: typeof fetch | undefined;
  /** Raw response capture directory (opt-in; overrides `CAPTURE_RAW_DIR`). */
  captureRawDir?: string | undefined;
  /** Replaces the Anthropic collectors (demo source, tests). */
  collectors?: DatasetCollector[] | undefined;
  /** Adjusts the loaded configuration (profiles and tests that enable optional sources). */
  configPatch?: ((config: AppConfig) => AppConfig) | undefined;
  /** Replaces the live matrix source (tests, demo). */
  matrix?: MatrixSource | null | undefined;
  /** Clock (ms) and sleep of the paced backfill clients (tests replace both). */
  httpTiming?: HttpTiming | undefined;
  source?: 'live' | 'demo' | undefined;
}

export interface HttpTiming {
  now?: (() => number) | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
}

/** Creates an HttpClient configured with the key of the given registered key family, if set. */
export function createHttpClientForFamily(
  env: Environment,
  familyId: string,
  fetchImpl?: typeof fetch,
  capture?: RawCapture,
  minIntervalMs?: number,
): HttpClient | null {
  const apiKey = env.keys[familyId];
  return apiKey
    ? new HttpClient({ apiKey, baseUrl: env.baseUrl, fetchImpl, capture, minIntervalMs })
    : null;
}

function anthropicApis(
  env: Environment,
  fetchImpl: typeof fetch | undefined,
  capture: RawCapture | undefined,
): AnthropicApis {
  const compliance = createHttpClientForFamily(env, 'compliance', fetchImpl, capture);
  const admin = createHttpClientForFamily(env, 'admin', fetchImpl, capture);
  const analytics = createHttpClientForFamily(env, 'analytics', fetchImpl, capture);
  return {
    compliance: compliance && new ComplianceApi(compliance),
    admin: admin && new AdminApi(admin),
    analytics: analytics && new AnalyticsApi(analytics),
  };
}

/**
 * Opt-in sources: registered only when enabled in config. One Console Admin key serves the B4
 * sources; feature usage (AN-6) and the per-day member activity (ledger, #158) read the
 * Analytics API with the Analytics key.
 */
function optionalCollectors(
  env: Environment,
  config: AppConfig,
  fetchImpl: typeof fetch | undefined,
  capture: RawCapture | undefined,
): DatasetCollector[] {
  const { console: consoleSource, claudeCode, featureUsage, memberActivityDaily } = config.sources;
  const http = createHttpClientForFamily(env, 'console', fetchImpl, capture);
  const analytics = createHttpClientForFamily(env, 'analytics', fetchImpl, capture);
  // The daily series has its own paced client so that it stays within the 60 requests/minute.
  const paced = createHttpClientForFamily(
    env,
    'analytics',
    fetchImpl,
    capture,
    MEMBER_DAILY_MIN_INTERVAL_MS,
  );
  return createOptionalCollectors(
    {
      console: http && new ConsoleAdminApi(http),
      claudeCode: http && new ClaudeCodeApi(http),
      featureUsage: analytics && new FeatureUsageApi(analytics),
      memberActivityDaily: paced && new MemberDailyActivityApi(paced),
    },
    {
      disabled: disabledDatasets(config),
      console: consoleSource,
      claudeCode,
      featureUsage,
      memberActivityDaily,
    },
  );
}

function liveSources(
  env: Environment,
  config: AppConfig,
  fetchImpl: typeof fetch | undefined,
  capture: RawCapture | undefined,
): { collectors: DatasetCollector[]; matrix: MatrixSource | null } {
  const { activities, members, memberActivity, groups, usageMatrix } = config.sources;
  const apis = anthropicApis(env, fetchImpl, capture);
  return {
    collectors: [
      ...createAnthropicCollectors(apis, {
        disabled: disabledDatasets(config),
        membersProvider: members.provider,
        memberActivityLookbackDays: memberActivity.lookbackDays,
        maxGroupMemberRequests: groups.maxMemberRequests,
        activities,
      }),
      ...optionalCollectors(env, config, fetchImpl, capture),
    ],
    matrix: usageMatrix.enabled ? apis.analytics : null,
  };
}

/** Opt-in: `--capture-raw <dir>` or `CAPTURE_RAW_DIR`. Real tenant data, so it is validated and announced. */
function rawCapture(
  env: Environment,
  dir: string | undefined,
  logger: Logger,
): RawCapture | undefined {
  if (!dir) return undefined;
  const resolved = resolveCaptureDir(env.baseDir, dir, env.ci);
  logger.warn(
    `Raw response capture is ON: tenant data is written to ${resolved}. Never commit it; sanitize it first (pnpm sanitize).`,
  );
  return new FileRawCapture(resolved);
}

/** Console always; Slack, Discord and e-mail when their secrets are present. */
function notifiers(
  env: Environment,
  logger: Logger,
  fetchImpl: typeof fetch | undefined,
): Notifier[] {
  return [
    consoleNotifier(logger),
    ...(env.slackWebhookUrl ? [slackNotifier(env.slackWebhookUrl, fetchImpl)] : []),
    ...(env.discordWebhookUrl ? [discordNotifier(env.discordWebhookUrl, fetchImpl)] : []),
    ...(env.smtp ? [emailNotifier(env.smtp)] : []),
  ];
}

/**
 * The backfill reads the APIs directly, one paced client per family for the whole run, so the
 * per-organization rate limits hold across every dataset it fetches.
 */
function backfillSources(
  env: Environment,
  config: AppConfig,
  fetchImpl: typeof fetch | undefined,
  timing: HttpTiming | undefined,
): Registry<BackfillDefinition> {
  const paced = (familyId: 'analytics' | 'compliance') => {
    const apiKey = env.keys[familyId];
    return apiKey
      ? new HttpClient({
          apiKey,
          baseUrl: env.baseUrl,
          fetchImpl,
          minIntervalMs: BACKFILL_MIN_INTERVAL_MS[familyId],
          now: timing?.now,
          sleep: timing?.sleep,
        })
      : null;
  };
  const analytics = paced('analytics');
  const compliance = paced('compliance');
  return createBackfillSources(
    {
      analytics: analytics && new AnalyticsApi(analytics),
      featureUsage: analytics && new FeatureUsageApi(analytics),
      memberActivityDaily: analytics && new MemberDailyActivityApi(analytics),
      compliance: compliance && new ComplianceApi(compliance),
    },
    { activities: config.sources.activities },
  );
}

/** Injected collectors / matrix source (demo, tests) win; otherwise the live gateways. */
function resolveSources(
  options: ContainerOptions,
  env: Environment,
  config: AppConfig,
  logger: Logger,
): Pick<Container, 'collectors' | 'matrix'> {
  const live = options.collectors
    ? undefined
    : liveSources(
        env,
        config,
        options.fetchImpl,
        rawCapture(env, options.captureRawDir ?? env.captureRawDir, logger),
      );
  return {
    collectors: options.collectors ?? live?.collectors ?? [],
    matrix: options.matrix === undefined ? (live?.matrix ?? null) : options.matrix,
  };
}

/**
 * Collectors that read the data directory (`ledgerHealth`, #160) join every source, live, demo or
 * injected, unless the source brings its own (the demo tenant) or the dataset is disabled.
 */
function withLocalCollectors(
  sources: Pick<Container, 'collectors' | 'matrix'>,
  store: FileStore,
  config: AppConfig,
): Pick<Container, 'collectors' | 'matrix'> {
  const local = [ledgerHealthCollector(store)].filter(
    (local) =>
      !disabledDatasets(config).includes(local.dataset) &&
      !sources.collectors.some((c) => c.dataset === local.dataset),
  );
  return { ...sources, collectors: [...sources.collectors, ...local] };
}

export async function createContainer(options: ContainerOptions = {}): Promise<Container> {
  const env = readEnvironment(options.env, options.cwd);
  const loaded = await loadConfig(env.configDir, env.configOverrides);
  const { customRules } = loaded;
  const config = options.configPatch ? options.configPatch(loaded.config) : loaded.config;
  const logger = options.logger ?? consoleLogger;
  const catalog = buildRuleCatalog(customRules);
  const unknown = unknownActivityTypes(catalog.activityWatches);
  if (unknown.length)
    logger.warn(`Activity watches reference unknown activity types: ${unknown.join(', ')}`);
  const store = new FileStore(options.dataDir ?? env.dataDir);
  const sources = withLocalCollectors(resolveSources(options, env, config, logger), store, config);
  return {
    env,
    config,
    customRules,
    source: options.source ?? 'live',
    clock: options.clock ?? systemClock,
    logger,
    store,
    snapshots: new FsSnapshotRepository(store),
    reports: new FsComplianceReportRepository(store),
    state: new FsStateRepository(store),
    artifacts: fileArtifacts(store),
    ...sources,
    backfill: backfillSources(env, config, options.fetchImpl, options.httpTiming),
    sealSinks: [],
    projections: BUILTIN_PROJECTIONS,
    rules: catalog.rules,
    analyzers: BUILTIN_ANALYZERS,
    reportDefinitions: new Registry<ReportDefinition>((d) => d.id, 'report').addAll(
      BUILTIN_REPORTS,
    ),
    renderers: BUILTIN_RENDERERS,
    notifiers: notifiers(env, logger, options.fetchImpl),
  };
}
