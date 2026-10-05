/**
 * Entities of the OPTIONAL data sources (B4): the linked Claude Console organization (Admin API)
 * and the Claude Code Analytics API. Same rule as `entities.ts`: our own words, external field
 * names never leak past the adapters.
 */

/** A workspace of the linked Claude Console organization. */
export interface ConsoleWorkspace {
  id: string;
  name: string;
  createdAt: string | null;
  /** Null while the workspace is active. */
  archivedAt: string | null;
}

/** A Console API key as listed by the Admin API (never the key itself or its hint). */
export interface ConsoleApiKey {
  id: string;
  name: string;
  /** Raw status (`active`, `inactive`, `archived`, ... open set). */
  status: string;
  /** Null for the default workspace and for keys without a workspace. */
  workspaceId: string | null;
  createdAt: string | null;
  /** Id of the user or service account that created the key. */
  createdBy: string | null;
}

/** Console token usage of one day, optionally broken down by workspace and model. */
export interface ConsoleUsageRow {
  /** Bucket start, `YYYY-MM-DD`. */
  date: string;
  /** Null for the default workspace or when the request was not grouped by workspace. */
  workspaceId: string | null;
  model: string | null;
  uncachedInputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  outputTokens: number;
  webSearchRequests: number;
}

/** Console cost of one day (post-discount, Priority Tier excluded by the API). */
export interface ConsoleCostRow {
  date: string;
  workspaceId: string | null;
  model: string | null;
  /** `tokens`, `web_search`, `code_execution`, ... (open set). */
  costType: string | null;
  /** Major currency units (dollars for USD). */
  amount: number;
  currency: string;
}

export interface ClaudeCodeModelUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** Major currency units; null when the API gave no estimate. */
  estimatedCost: number | null;
}

/**
 * One actor's Claude Code activity on one day. The actor is a person (`user`, identified by
 * e-mail) or an API key (`api`, identified by its name). Per-person data: it stays in the
 * snapshot files and is never published (docs/BLUEPRINT.md section 9).
 */
export interface ClaudeCodeActivity {
  date: string;
  actorKind: string;
  /** E-mail address (`user`) or key name (`api`). */
  actor: string | null;
  customerType: string | null;
  terminalType: string | null;
  sessions: number;
  linesAdded: number;
  linesRemoved: number;
  commits: number;
  pullRequests: number;
  /** Edit / write tool proposals the user accepted or rejected, summed over all tools. */
  toolAccepted: number;
  toolRejected: number;
  models: ClaudeCodeModelUsage[];
}
