import { ADMIN_ROLES } from '../../model/vocabulary.js';
import type { ActivityWatch } from './activity-watch.js';
import type { SettingBaseline } from './setting-baseline.js';

/** Configuration baselines (CF-xxx) evaluated against effective organization settings. */
export const DEFAULT_SETTING_BASELINES: readonly SettingBaseline[] = [
  {
    id: 'CF-001',
    name: 'SSO Enforced for claude.ai',
    severity: 'high',
    setting: 'sso_claude_ai_enforced',
    expect: { kind: 'equals', value: true },
    remediation: 'Enforce single sign-on for claude.ai in organization settings.',
  },
  {
    id: 'CF-002',
    name: 'SCIM Provisioning',
    severity: 'medium',
    setting: 'sso_provisioning_mode',
    expect: { kind: 'oneOf', values: ['scim_advanced', 'scim_permissive'] },
    remediation: 'Provision members through SCIM directory sync so offboarding is automatic.',
  },
  {
    id: 'CF-003',
    name: 'IP Allowlist Enabled',
    severity: 'medium',
    setting: 'ip_allowlist_enabled',
    expect: { kind: 'equals', value: true },
    remediation: 'Restrict access to corporate network ranges with the IP allowlist.',
  },
  {
    id: 'CF-004',
    name: 'Session Duration Limited',
    severity: 'low',
    setting: 'account_session_duration_seconds',
    expect: { kind: 'max', value: 604_800 },
    remediation: 'Limit the account session duration to 7 days or less.',
  },
  {
    id: 'CF-005',
    name: 'Finite Data Retention',
    severity: 'medium',
    setting: 'data_retention_periods',
    expect: { kind: 'retentionAtMostDays', days: 365 },
    remediation: 'Configure a fixed data retention period that matches your records policy.',
  },
  {
    id: 'CF-006',
    name: 'Public Projects Disabled',
    severity: 'medium',
    setting: 'public_projects_enabled',
    expect: { kind: 'equals', value: false },
    remediation: 'Disable public projects to keep project content inside the organization.',
  },
  {
    id: 'CF-007',
    name: 'Code Execution Egress Restricted',
    severity: 'medium',
    setting: 'code_execution_network_egress_enabled',
    expect: { kind: 'equals', value: false },
    remediation: 'Disable network egress for code execution unless it is explicitly required.',
  },
  {
    id: 'CF-008',
    name: 'Claude Code Permission Bypass Disabled',
    severity: 'high',
    setting: 'claude_code_desktop_bypass_permissions_enabled',
    expect: { kind: 'equals', value: false },
    remediation: 'Disallow bypass-permissions mode for Claude Code on desktop.',
  },
  {
    id: 'CF-009',
    name: 'Invite Domains Restricted',
    severity: 'low',
    setting: 'allowed_invite_domains',
    expect: { kind: 'nonEmpty' },
    remediation: 'Limit invitations to your corporate email domains.',
  },
];

/** Activity watches (AM-xxx) evaluated against the Activity Feed delta of each collection. */
export const DEFAULT_ACTIVITY_WATCHES: readonly ActivityWatch[] = [
  {
    id: 'AM-001',
    name: 'Privileged Role Changes',
    severity: 'high',
    match: [
      {
        types: [
          'primary_owner_transferred',
          'rbac_role_assigned',
          'rbac_role_permission_added',
          'role_assignment_granted',
        ],
      },
      {
        types: ['claude_user_role_updated'],
        where: { attribute: 'current_role', in: [...ADMIN_ROLES] },
      },
    ],
  },
  {
    id: 'AM-002',
    name: 'Identity Provider Changes',
    severity: 'high',
    match: [
      {
        types: [
          'org_sso_toggled',
          'org_sso_connection_deactivated',
          'org_sso_connection_deleted',
          'org_sso_provisioning_mode_changed',
          'org_sso_group_role_mappings_updated',
          'org_directory_sync_deleted',
        ],
      },
    ],
  },
  {
    id: 'AM-003',
    name: 'Network Restriction Changes',
    severity: 'medium',
    match: [
      {
        types: [
          'org_ip_restriction_created',
          'org_ip_restriction_updated',
          'org_ip_restriction_deleted',
        ],
      },
    ],
  },
  {
    id: 'AM-004',
    name: 'API Key Lifecycle',
    severity: 'medium',
    match: [
      {
        types: [
          'api_key_created',
          'admin_api_key_created',
          'admin_api_key_updated',
          'admin_api_key_deleted',
          'scoped_api_key_updated',
          'scoped_api_key_deleted',
          'org_compliance_api_settings_updated',
          'org_analytics_api_capability_updated',
        ],
      },
    ],
  },
  {
    id: 'AM-005',
    name: 'Data Export Events',
    severity: 'medium',
    match: [
      {
        types: [
          'org_data_export_started',
          'org_data_export_accessed',
          'org_members_exported',
          'audit_log_export_started',
          'audit_log_export_accessed',
        ],
      },
    ],
  },
  {
    id: 'AM-006',
    name: 'Authentication Failure Burst',
    severity: 'medium',
    threshold: 20,
    match: [
      { types: ['sso_login_failed', 'magic_link_login_failed', 'step_up_authentication_failed'] },
    ],
  },
  {
    id: 'AM-007',
    name: 'Data Protection Changes',
    severity: 'high',
    match: [
      {
        types: [
          'org_claude_code_zero_data_retention_disabled',
          'org_data_residency_updated',
          'platform_workspace_inference_data_retention_disabled',
        ],
      },
    ],
  },
];
