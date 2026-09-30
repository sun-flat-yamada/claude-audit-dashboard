/**
 * Plugin system type definitions
 *
 * Provides extensible interfaces for compliance rules, alert triggers,
 * and notification channels. Plugins are self-registering and require
 * zero modifications to core orchestration code.
 */

import type { Severity, ComplianceCategory, ComplianceCheckResult } from './compliance.js';
import type { NotificationChannel, NotificationPriority, Notification } from './notification.js';
import type { AuditSnapshot, UsageReport } from './audit.js';

// ─── Compliance Rule Plugin ───────────────────────────────────────

/** Interface for pluggable compliance rules */
export interface ComplianceRulePlugin {
  /** Unique rule ID (e.g., 'AC-001', 'CUSTOM-001') */
  readonly id: string;
  /** Human-readable name */
  readonly name: string;
  /** Rule description */
  readonly description: string;
  /** Category for grouping */
  readonly category: ComplianceCategory;
  /** Default severity */
  readonly severity: Severity;
  /** Configurable parameters with defaults */
  readonly defaultParams: Record<string, unknown>;

  /**
   * Execute the compliance check against the current snapshot.
   * @returns One or more check results
   */
  check(
    snapshot: AuditSnapshot,
    params: Record<string, unknown>,
  ): Promise<ComplianceCheckResult[]>;
}

// ─── Alert Trigger Plugin ─────────────────────────────────────────

/** Context provided to alert trigger plugins for evaluation */
export interface AlertContext {
  currentSnapshot: AuditSnapshot;
  previousSnapshot: AuditSnapshot | null;
  complianceReport: ComplianceReport;
  collectorState: CollectorState;
  config: Record<string, unknown>;
}

/** Collector state for trigger evaluation */
export interface CollectorState {
  last_collection_at: string | null;
  last_activity_id: string | null;
  collection_count: number;
}

/** Interface for pluggable alert triggers */
export interface AlertTriggerPlugin {
  /** Unique trigger ID */
  readonly id: string;
  /** Human-readable name */
  readonly name: string;
  /** Description of what this trigger detects */
  readonly description: string;
  /** Default priority */
  readonly defaultPriority: NotificationPriority;
  /** Channels this trigger should notify (default) */
  readonly defaultChannels: NotificationChannel[];
  /** Cooldown in minutes to avoid alert storms */
  readonly cooldownMinutes: number;

  /**
   * Evaluate the trigger condition.
   * @returns Alert notifications to send, or empty array if no alert
   */
  evaluate(context: AlertContext): Promise<Notification[]>;
}

// ─── Notification Channel Plugin ──────────────────────────────────

/** Interface for pluggable notification channels */
export interface NotificationChannelPlugin {
  /** Channel identifier (e.g., 'slack', 'discord', 'email', 'teams') */
  readonly id: string;
  /** Human-readable name */
  readonly name: string;

  /** Initialize the channel. Called once during startup. */
  initialize(config: Record<string, unknown>): Promise<void>;

  /** Send a notification through this channel. */
  send(notification: Notification): Promise<void>;

  /** Cleanup resources on shutdown. */
  destroy(): Promise<void>;
}

// ─── Monthly Report Plugin ────────────────────────────────────────

/** Monthly billing report data structure */
export interface MonthlyBillingReport {
  report_id: string;
  month: string;
  generated_at: string;
  organization: {
    id: string;
    name: string;
  };
  summary: BillingSummary;
  by_workspace: WorkspaceBilling[];
  by_model: ModelBilling[];
  daily_breakdown: DailyBilling[];
  raw_records: RawUsageRecord[];
}

/** Billing summary for the month */
export interface BillingSummary {
  total_cost_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cached_tokens: number;
  total_cache_creation_tokens: number;
  average_daily_cost_usd: number;
  projected_annual_cost_usd: number;
  month_over_month_change_pct: number | null;
}

/** Workspace-level billing breakdown */
export interface WorkspaceBilling {
  workspace_id: string;
  workspace_name: string;
  cost_usd: number;
  percentage_of_total: number;
  input_tokens: number;
  output_tokens: number;
  by_model: ModelBilling[];
}

/** Model-level billing breakdown */
export interface ModelBilling {
  model: string;
  cost_usd: number;
  percentage_of_total: number;
  input_tokens: number;
  output_tokens: number;
  cost_per_million_input: number;
  cost_per_million_output: number;
}

/** Daily billing data */
export interface DailyBilling {
  date: string;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
}

/** Raw usage record for full audit trail */
export interface RawUsageRecord {
  timestamp: string;
  workspace_id: string;
  workspace_name: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  cache_creation_tokens: number;
  cost_usd: number;
}

// ─── Model Usage Analysis ─────────────────────────────────────────

/** Analysis recommendation */
export interface UsageRecommendation {
  id: string;
  type: 'model-optimization' | 'caching' | 'workspace-rebalance' | 'cost-reduction';
  title: string;
  impact_estimate_usd: number;
  details: string;
  priority: 'high' | 'medium' | 'low';
}

/** Monthly model usage analysis result */
export interface ModelUsageAnalysis {
  month: string;
  generated_at: string;
  total_cost_usd: number;
  model_distribution: ModelDistribution[];
  workspace_model_matrix: WorkspaceModelUsage[];
  cache_efficiency: CacheEfficiency;
  recommendations: UsageRecommendation[];
}

/** Distribution of usage across models */
export interface ModelDistribution {
  model: string;
  percentage: number;
  cost_usd: number;
  trend: 'increasing' | 'stable' | 'decreasing';
}

/** Workspace × model usage matrix entry */
export interface WorkspaceModelUsage {
  workspace_id: string;
  workspace_name: string;
  model: string;
  tokens: number;
  cost_usd: number;
  percentage_of_workspace: number;
}

/** Cache efficiency metrics */
export interface CacheEfficiency {
  overall_hit_rate: number;
  by_workspace: {
    workspace_id: string;
    workspace_name: string;
    hit_rate: number;
    potential_savings_usd: number;
  }[];
}

// ─── Re-export for convenience ────────────────────────────────────

import type { ComplianceReport } from './compliance.js';
export type { ComplianceReport };
