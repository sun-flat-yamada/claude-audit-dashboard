/** Built-in roles with administrative power across Claude Enterprise and linked Console orgs. */
export const ADMIN_ROLES = [
  'primary_owner',
  'owner',
  'admin',
  'membership_admin',
  'parent_org_owner',
  'parent_org_admin',
] as const;

export const PRIMARY_OWNER_ROLE = 'primary_owner';

/** Scopes whose use is recorded as `compliance_api_accessed` activities. */
export const COMPLIANCE_SCOPES = [
  'read:compliance_activities',
  'read:compliance_org_data',
  'read:compliance_user_data',
  'delete:compliance_user_data',
  'read:org_audit',
] as const;

/** Scopes that can change or destroy tenant data; standing keys should not hold them. */
export const PRIVILEGED_SCOPES = [
  'delete:compliance_user_data',
  'write:members',
  'write:rbac_groups',
  'write:spend_limits',
] as const;

/**
 * Activity types recorded every time a Claude app loads content (not a human view, and not
 * de-duplicated). Excluded from collection by default to keep the data branch small.
 */
export const CONTENT_VIEW_ACTIVITY_TYPES = [
  'claude_artifact_comments_viewed',
  'claude_artifact_viewed',
  'claude_chat_snapshot_viewed',
  'claude_chat_viewed',
  'claude_file_viewed',
  'claude_project_document_viewed',
  'claude_project_viewed',
  'design_project_viewed',
] as const;
