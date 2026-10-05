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
import { createAnthropicCollectors, type AnthropicApis } from '../adapters/anthropic/collectors.js';
import { ComplianceApi } from '../adapters/anthropic/compliance-api.js';
import { HttpClient } from '../adapters/anthropic/http-client.js';
import {
  FileRawCapture,
  resolveCaptureDir,
  type RawCapture,
} from '../adapters/anthropic/raw-capture.js';
import { consoleNotifier, discordNotifier, slackNotifier } from '../adapters/notifiers/channels.js';
import { emailNotifier } from '../adapters/notifiers/email.js';
import { BUILTIN_RENDERERS } from '../adapters/renderers/index.js';
import { FileStore } from '../adapters/storage/file-store.js';
import {
  FsComplianceReportRepository,
  FsSnapshotRepository,
  FsStateRepository,
  fileArtifacts,
} from '../adapters/storage/repositories.js';
import { disabledDatasets, loadConfig, type AppConfig } from '../infrastructure/config.js';
import { readEnvironment, type Environment } from '../infrastructure/env.js';
import { consoleLogger, systemClock } from '../infrastructure/runtime.js';

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
  source?: 'live' | 'demo' | undefined;
}

function anthropicApis(
  env: Environment,
  fetchImpl: typeof fetch | undefined,
  capture: RawCapture | undefined,
): AnthropicApis {
  const client = (apiKey: string | undefined) =>
    apiKey ? new HttpClient({ apiKey, baseUrl: env.baseUrl, fetchImpl, capture }) : null;
  const compliance = client(env.keys.compliance);
  const admin = client(env.keys.admin);
  const analytics = client(env.keys.analytics);
  return {
    compliance: compliance && new ComplianceApi(compliance),
    admin: admin && new AdminApi(admin),
    analytics: analytics && new AnalyticsApi(analytics),
  };
}

function liveCollectors(
  env: Environment,
  config: AppConfig,
  fetchImpl: typeof fetch | undefined,
  capture: RawCapture | undefined,
): DatasetCollector[] {
  const { activities, members, memberActivity, groups } = config.sources;
  return createAnthropicCollectors(anthropicApis(env, fetchImpl, capture), {
    disabled: disabledDatasets(config),
    membersProvider: members.provider,
    memberActivityLookbackDays: memberActivity.lookbackDays,
    maxGroupMemberRequests: groups.maxMemberRequests,
    activities,
  });
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

export async function createContainer(options: ContainerOptions = {}): Promise<Container> {
  const env = readEnvironment(options.env, options.cwd);
  const { config, customRules } = await loadConfig(env.configDir);
  const logger = options.logger ?? consoleLogger;
  const catalog = buildRuleCatalog(customRules);
  const unknown = unknownActivityTypes(catalog.activityWatches);
  if (unknown.length)
    logger.warn(`Activity watches reference unknown activity types: ${unknown.join(', ')}`);
  const store = new FileStore(options.dataDir ?? env.dataDir);
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
    collectors:
      options.collectors ??
      liveCollectors(
        env,
        config,
        options.fetchImpl,
        rawCapture(env, options.captureRawDir ?? env.captureRawDir, logger),
      ),
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
