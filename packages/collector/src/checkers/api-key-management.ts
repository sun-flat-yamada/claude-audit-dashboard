import type { ApiKeyInfo, ComplianceEvidence, ComplianceRulePlugin } from '@claude-audit/shared';
import { ageDays, makeResult, num } from './helpers.js';

const meta = {
  unused: {
    id: 'AK-001',
    name: 'Unused API Keys',
    category: 'api-key-management',
    severity: 'medium',
  },
  unscoped: {
    id: 'AK-002',
    name: 'Unscoped API Keys',
    category: 'api-key-management',
    severity: 'high',
  },
  age: { id: 'AK-003', name: 'API Key Age', category: 'api-key-management', severity: 'medium' },
} as const;

const active = (keys: ApiKeyInfo[]) => keys.filter((k) => k.status === 'active');

const keyEvidence = (k: ApiKeyInfo, description: string): ComplianceEvidence => ({
  type: 'api_key',
  id: k.id,
  description,
  data: { name: k.name },
});

export const unusedApiKeys: ComplianceRulePlugin = {
  ...meta.unused,
  description: 'Detect API keys that have not been used in the last 30 days',
  defaultParams: { unusedDays: 30 },
  async check(snapshot, params) {
    const days = num(params, 'unusedDays', 30);
    const stale = active(snapshot.api_keys).filter(
      (k) => ageDays(k.last_used_at ?? k.created_at, params) > days,
    );
    if (stale.length === 0) return [makeResult(meta.unused, 'pass', 'No unused API keys')];
    return [
      makeResult(meta.unused, 'fail', `${stale.length} API key(s) unused for over ${days} days`, {
        evidence: stale.map((k) => keyEvidence(k, `Last used ${k.last_used_at ?? 'never'}`)),
        remediation: 'Disable API keys that are no longer needed.',
      }),
    ];
  },
};

export const unscopedApiKeys: ComplianceRulePlugin = {
  ...meta.unscoped,
  description: 'Detect API keys that are not scoped to specific workspaces',
  defaultParams: {},
  async check(snapshot) {
    const unscoped = active(snapshot.api_keys).filter((k) => k.workspace_id === null);
    if (unscoped.length === 0)
      return [makeResult(meta.unscoped, 'pass', 'All API keys are scoped')];
    return [
      makeResult(meta.unscoped, 'fail', `${unscoped.length} API key(s) not scoped to a workspace`, {
        evidence: unscoped.map((k) => keyEvidence(k, 'No workspace restriction')),
        remediation: 'Recreate keys within a specific workspace.',
      }),
    ];
  },
};

export const apiKeyAge: ComplianceRulePlugin = {
  ...meta.age,
  description: 'Warn about API keys older than 180 days that should be rotated',
  defaultParams: { maxAgeDays: 180 },
  async check(snapshot, params) {
    const days = num(params, 'maxAgeDays', 180);
    const old = active(snapshot.api_keys).filter((k) => ageDays(k.created_at, params) > days);
    if (old.length === 0) return [makeResult(meta.age, 'pass', 'No API keys require rotation')];
    return [
      makeResult(meta.age, 'fail', `${old.length} API key(s) older than ${days} days`, {
        evidence: old.map((k) => keyEvidence(k, `Created ${k.created_at}`)),
        remediation: 'Rotate these API keys.',
      }),
    ];
  },
};

export const apiKeyManagementRules = [unusedApiKeys, unscopedApiKeys, apiKeyAge];
