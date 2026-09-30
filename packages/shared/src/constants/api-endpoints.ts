import { ANTHROPIC_API_BASE_URL } from '../types/api.js';

/**
 * Anthropic API endpoint constants
 */
export const API_ENDPOINTS = {
  // Compliance API
  COMPLIANCE_ACTIVITIES: `${ANTHROPIC_API_BASE_URL}/v1/compliance/activities`,

  // Admin API - Organization
  ORG_MEMBERS: `${ANTHROPIC_API_BASE_URL}/v1/organizations/users`,
  ORG_WORKSPACES: `${ANTHROPIC_API_BASE_URL}/v1/organizations/workspaces`,
  ORG_API_KEYS: `${ANTHROPIC_API_BASE_URL}/v1/organizations/api_keys`,
  ORG_INVITES: `${ANTHROPIC_API_BASE_URL}/v1/organizations/invites`,
  ORG_USAGE_REPORT_MESSAGES: `${ANTHROPIC_API_BASE_URL}/v1/organizations/usage_report/messages`,
  ORG_COST_REPORT: `${ANTHROPIC_API_BASE_URL}/v1/organizations/cost_report`,
} as const;

/** Default pagination limit */
export const DEFAULT_PAGE_LIMIT = 100;

/** Maximum pagination limit */
export const MAX_PAGE_LIMIT = 1000;
