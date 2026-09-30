/**
 * Audit activity types from the Compliance API
 */

/** Activity event categories */
export type ActivityCategory =
  'admin' | 'identity' | 'configuration' | 'resource' | 'access' | 'security';

/** Activity event from GET /v1/compliance/activities */
export interface AuditActivity {
  id: string;
  type: string;
  category: ActivityCategory;
  actor: ActivityActor;
  target: ActivityTarget | null;
  details: Record<string, unknown>;
  timestamp: string;
  organization_id: string;
  workspace_id: string | null;
}

/** Who performed the action */
export interface ActivityActor {
  type: 'user' | 'api_key' | 'system' | 'service_account';
  id: string;
  name: string | null;
  email: string | null;
}

/** What was affected */
export interface ActivityTarget {
  type: string;
  id: string;
  name: string | null;
}

/** Organization member info from Admin API */
export interface OrganizationMember {
  id: string;
  email: string;
  name: string;
  role: OrganizationRole;
  created_at: string;
  last_active_at: string | null;
}

/** Organization roles */
export type OrganizationRole =
  'primary_owner' | 'owner' | 'admin' | 'developer' | 'billing' | 'user';

/** Workspace info from Admin API */
export interface Workspace {
  id: string;
  name: string;
  created_at: string;
  archived_at: string | null;
  member_count: number;
}

/** API Key info from Admin API */
export interface ApiKeyInfo {
  id: string;
  name: string;
  type: string;
  status: 'active' | 'disabled' | 'expired';
  created_at: string;
  last_used_at: string | null;
  created_by: {
    id: string;
    name: string | null;
  };
  workspace_id: string | null;
  scopes: string[];
}

/** Usage report data from Admin API */
export interface UsageReport {
  period_start: string;
  period_end: string;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
  by_workspace: WorkspaceUsage[];
  by_model: ModelUsage[];
}

/** Usage breakdown by workspace */
export interface WorkspaceUsage {
  workspace_id: string;
  workspace_name: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

/** Usage breakdown by model */
export interface ModelUsage {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

/** Collected audit snapshot stored as JSON data */
export interface AuditSnapshot {
  collected_at: string;
  collection_id: string;
  organization_id: string;
  activities: AuditActivity[];
  members: OrganizationMember[];
  workspaces: Workspace[];
  api_keys: ApiKeyInfo[];
  usage: UsageReport | null;
  metadata: {
    collector_version: string;
    duration_ms: number;
    activity_count: number;
    sync_type: 'incremental' | 'full';
    last_activity_id: string | null;
  };
}
