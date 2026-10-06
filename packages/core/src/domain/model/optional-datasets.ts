import type {
  ChatProjectUsage,
  ClaudeCodeActivity,
  ConsoleApiKey,
  ConsoleCostRow,
  ConsoleUsageRow,
  ConsoleWorkspace,
  ConnectorUsage,
  PluginUsage,
  SkillUsage,
} from './optional-entities.js';

/**
 * Datasets of the optional sources. They are registered (collected, covered, checked by
 * OP-002) only when their source is enabled in config (`sources.console.enabled`,
 * `sources.claudeCode.enabled`, `sources.featureUsage.enabled`, default off), so a tenant that never enables them sees no
 * difference in coverage, OP-002 or score.
 */
export interface OptionalDatasetMap {
  consoleWorkspaces: ConsoleWorkspace[];
  consoleApiKeys: ConsoleApiKey[];
  consoleUsage: ConsoleUsageRow[];
  consoleCost: ConsoleCostRow[];
  claudeCodeActivity: ClaudeCodeActivity[];
  skillUsage: SkillUsage[];
  connectorUsage: ConnectorUsage[];
  pluginUsage: PluginUsage[];
  chatProjectUsage: ChatProjectUsage[];
}

export type OptionalDatasetName = keyof OptionalDatasetMap;

/** The config flag (`sources.<flag>.enabled`) that turns each optional dataset on. */
export const OPTIONAL_SOURCES = {
  consoleWorkspaces: 'console',
  consoleApiKeys: 'console',
  consoleUsage: 'console',
  consoleCost: 'console',
  claudeCodeActivity: 'claudeCode',
  skillUsage: 'featureUsage',
  connectorUsage: 'featureUsage',
  pluginUsage: 'featureUsage',
  chatProjectUsage: 'featureUsage',
} as const satisfies Record<OptionalDatasetName, string>;

export type OptionalSource = (typeof OPTIONAL_SOURCES)[OptionalDatasetName];

export const emptyOptionalData = (): OptionalDatasetMap => ({
  consoleWorkspaces: [],
  consoleApiKeys: [],
  consoleUsage: [],
  consoleCost: [],
  claudeCodeActivity: [],
  skillUsage: [],
  connectorUsage: [],
  pluginUsage: [],
  chatProjectUsage: [],
});

export const OPTIONAL_DATASET_NAMES = Object.keys(OPTIONAL_SOURCES) as OptionalDatasetName[];

export const isOptionalDatasetName = (value: string): value is OptionalDatasetName =>
  (OPTIONAL_DATASET_NAMES as string[]).includes(value);

/** Optional datasets that belong to the given source flag. */
export const datasetsOfSource = (source: OptionalSource): OptionalDatasetName[] =>
  OPTIONAL_DATASET_NAMES.filter((name) => OPTIONAL_SOURCES[name] === source);
