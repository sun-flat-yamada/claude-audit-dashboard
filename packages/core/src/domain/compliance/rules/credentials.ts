import { z } from 'zod';
import type { Credential } from '../../model/entities.js';
import { COMPLIANCE_SCOPES, PRIVILEGED_SCOPES } from '../../model/vocabulary.js';
import { addDays, daysBetween } from '../../util/time.js';
import { defineRule } from '../define-rule.js';
import { failIfAny, skip, type Evidence } from '../types.js';

const credentialEvidence = (c: Credential, label: string): Evidence => ({
  kind: 'credential',
  id: c.id,
  label: `${c.name}: ${label}`,
});

const usesComplianceApi = (c: Credential): boolean =>
  c.scopes.some((scope) => (COMPLIANCE_SCOPES as readonly string[]).includes(scope));

export const unusedCredentials = defineRule({
  meta: {
    id: 'AK-001',
    name: 'Unused API Keys',
    category: 'api-key-management',
    severity: 'medium',
    description:
      'Active keys with Compliance API scopes not observed calling the API within the threshold',
    remediation: 'Deactivate keys that are no longer used.',
  },
  requires: ['credentials', 'credentialUsage'],
  params: z.object({ unusedDays: z.number().int().positive().default(30) }),
  evaluate({ data, coverage, params, now }) {
    const cutoff = addDays(now, -params.unusedDays);
    const observedFrom = coverage.credentialUsage?.window?.from;
    if (!observedFrom || new Date(observedFrom) > cutoff) {
      return skip(
        `Key usage observed since ${observedFrom ?? 'never'}; ${params.unusedDays} days needed`,
      );
    }
    const lastSeen = new Map(data.credentialUsage.map((u) => [u.credentialId, u.lastSeenAt]));
    const active = data.credentials.filter((c) => c.active);
    if (!active.some((c) => lastSeen.has(c.id))) {
      return skip('No observed API activity matches a known key id');
    }
    const unused = active.filter(
      (c) =>
        usesComplianceApi(c) &&
        new Date(c.createdAt) <= cutoff &&
        new Date(lastSeen.get(c.id) ?? 0) <= cutoff,
    );
    return failIfAny(
      unused,
      {
        pass: `Every compliance key was used within ${params.unusedDays} days`,
        fail: (n) => `${n} key(s) unused for more than ${params.unusedDays} days`,
      },
      (c) => credentialEvidence(c, `last seen ${lastSeen.get(c.id)?.slice(0, 10) ?? 'never'}`),
    );
  },
});

export const privilegedCredentials = defineRule({
  meta: {
    id: 'AK-002',
    name: 'Over-privileged API Keys',
    category: 'api-key-management',
    severity: 'high',
    description: 'Active keys holding scopes that can change or delete tenant data',
    remediation:
      'Keep standing keys read-only; create a separate, short-lived key for write or delete work.',
  },
  requires: ['credentials'],
  params: z.object({ flaggedScopes: z.array(z.string()).default([...PRIVILEGED_SCOPES]) }),
  evaluate({ data, params }) {
    const flagged = data.credentials
      .filter((c) => c.active)
      .map((c) => ({ c, scopes: c.scopes.filter((s) => params.flaggedScopes.includes(s)) }))
      .filter((entry) => entry.scopes.length > 0);
    return failIfAny(
      flagged,
      {
        pass: 'No active key holds write or delete scopes',
        fail: (n) => `${n} active key(s) hold write or delete scopes`,
      },
      (entry) => credentialEvidence(entry.c, entry.scopes.join(', ')),
    );
  },
});

export const credentialAge = defineRule({
  meta: {
    id: 'AK-003',
    name: 'API Key Age',
    category: 'api-key-management',
    severity: 'medium',
    description: 'Active keys older than the rotation threshold',
    remediation: 'Rotate: create a replacement key, switch integrations, then delete the old key.',
  },
  requires: ['credentials'],
  params: z.object({ maxAgeDays: z.number().int().positive().default(180) }),
  evaluate({ data, params, now }) {
    return failIfAny(
      data.credentials.filter((c) => c.active && daysBetween(c.createdAt, now) > params.maxAgeDays),
      {
        pass: `No active key older than ${params.maxAgeDays} days`,
        fail: (n) => `${n} active key(s) older than ${params.maxAgeDays} days`,
      },
      (c) => credentialEvidence(c, `created ${c.createdAt.slice(0, 10)}`),
    );
  },
});

export const credentialRules = [unusedCredentials, privilegedCredentials, credentialAge];
