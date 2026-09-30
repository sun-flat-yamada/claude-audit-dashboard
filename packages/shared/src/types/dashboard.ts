/**
 * Dashboard data types for the frontend
 */

import type { ComplianceReport, ComplianceSummary, Severity } from './compliance.js';
import type { AuditActivity, UsageReport, OrganizationMember, Workspace, ApiKeyInfo } from './audit.js';

/** Dashboard overview data loaded by the frontend */
export interface DashboardData {
  last_updated: string;
  organization: OrganizationOverview;
  compliance: ComplianceDashboard;
  usage: UsageDashboard;
  activities: ActivityDashboard;
  alerts: AlertDashboard;
}

/** Organization overview */
export interface OrganizationOverview {
  id: string;
  name: string;
  member_count: number;
  workspace_count: number;
  active_api_key_count: number;
  members: OrganizationMember[];
  workspaces: Workspace[];
  api_keys: ApiKeyInfo[];
}

/** Compliance dashboard section */
export interface ComplianceDashboard {
  current_score: number;
  trend: TrendPoint[];
  latest_report: ComplianceReport;
  summary: ComplianceSummary;
  critical_findings: number;
  history: ComplianceHistoryEntry[];
}

/** Usage dashboard section */
export interface UsageDashboard {
  current_period: UsageReport;
  daily_trend: DailyUsage[];
  cost_trend: TrendPoint[];
  top_workspaces: WorkspaceUsageSummary[];
  top_models: ModelUsageSummary[];
}

/** Activity dashboard section */
export interface ActivityDashboard {
  recent_activities: AuditActivity[];
  activity_count_by_category: Record<string, number>;
  activity_trend: TrendPoint[];
  notable_events: NotableEvent[];
}

/** Alert dashboard section */
export interface AlertDashboard {
  active_alerts: DashboardAlert[];
  resolved_alerts: DashboardAlert[];
  alert_trend: TrendPoint[];
}

/** A point in a trend line */
export interface TrendPoint {
  date: string;
  value: number;
}

/** Daily usage data */
export interface DailyUsage {
  date: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

/** Workspace usage summary for charts */
export interface WorkspaceUsageSummary {
  workspace_id: string;
  workspace_name: string;
  total_tokens: number;
  cost_usd: number;
  percentage: number;
}

/** Model usage summary for charts */
export interface ModelUsageSummary {
  model: string;
  total_tokens: number;
  cost_usd: number;
  percentage: number;
}

/** Compliance history for trend charts */
export interface ComplianceHistoryEntry {
  date: string;
  score: number;
  passed: number;
  failed: number;
  warnings: number;
}

/** Notable event for display */
export interface NotableEvent {
  id: string;
  type: string;
  severity: Severity;
  title: string;
  description: string;
  timestamp: string;
  actor: string;
}

/** Dashboard alert */
export interface DashboardAlert {
  id: string;
  severity: Severity;
  title: string;
  message: string;
  source: string;
  created_at: string;
  resolved_at: string | null;
  acknowledged: boolean;
}
