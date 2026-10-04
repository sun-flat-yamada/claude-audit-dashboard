import { describe, expect, it } from 'vitest';
import { FIXTURES } from '../../../__tests__/fake-anthropic.js';
import { Sanitizer } from '../sanitizer.js';

const REAL_USER = 'user_01Jz3a4bC5dE6fG7hI8jK9lM';
const REAL_KEY = 'apikey_01Hx7k2mP9nQ4rS6tU8vW0xY';
const REAL_ORG = '5b1c0e5e-7a43-4d52-9d6b-0e1f2a3b4c5d';

const shapeOf = (value: string) =>
  value.replace(/[A-Z]/g, 'A').replace(/[a-z]/g, 'a').replace(/\d/g, '9');

describe('Sanitizer', () => {
  it('maps e-mail addresses to userN@example.com, case-insensitively and consistently', () => {
    const s = new Sanitizer();
    const out = s.sanitize({
      a: 'Jane.Doe@corp-internal.io',
      b: 'jane.doe@corp-internal.io',
      c: 'mail to jane.doe@corp-internal.io or bob@corp-internal.io',
    });
    expect(out.a).toBe('user1@example.com');
    expect(out.b).toBe('user1@example.com');
    expect(out.c).toBe('mail to user1@example.com or user2@example.com');
  });

  it('keeps prefix, length and character classes of IDs, deterministically', () => {
    const first = new Sanitizer().sanitize(REAL_USER);
    expect(first).not.toBe(REAL_USER);
    expect(first.startsWith('user_')).toBe(true);
    expect(first).toHaveLength(REAL_USER.length);
    expect(shapeOf(first)).toBe(shapeOf(REAL_USER));
    expect(new Sanitizer().sanitize(REAL_USER)).toBe(first);
    expect(new Sanitizer('another-salt').sanitize(REAL_USER)).not.toBe(first);
  });

  it('maps one real ID to one synthetic ID across files, keys, query values and paths', () => {
    const s = new Sanitizer();
    const activity = s.sanitize({ actor: { type: 'api_actor', api_key_id: REAL_KEY } });
    const settings = s.sanitize({ api_keys: [{ id: REAL_KEY, name: 'k' }] });
    const request = s.sanitize({ path: `/v1/compliance/organizations/${REAL_ORG}/settings` });
    const byKey = s.sanitize({ [REAL_KEY]: 1 });
    expect(activity.actor.api_key_id).toBe(settings.api_keys[0]?.id);
    expect(Object.keys(byKey)).toEqual([activity.actor.api_key_id]);
    expect(request.path).toMatch(
      /^\/v1\/compliance\/organizations\/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\/settings$/,
    );
    expect(request.path).not.toContain(REAL_ORG);
  });

  it('never maps two different real IDs to the same synthetic ID', () => {
    const s = new Sanitizer();
    const ids = Array.from({ length: 300 }, (_, i) => `user_${String(i).padStart(2, '0')}`);
    const out = ids.map((id) => s.sanitize(id));
    expect(new Set(out).size).toBe(ids.length);
    expect(out.every((id) => /^user_\d\d$/.test(id))).toBe(false);
  });

  it('leaves enum values, field names and plain words alone', () => {
    const value = {
      type: 'claude_user_role_updated',
      actor: { type: 'api_actor' },
      rbac_group_id: null,
      cache_creation: { ephemeral_1h_input_tokens: 1 },
      model: 'claude-opus-5',
      date: '2026-09-29T00:00:00Z',
      source: { type: 'seat_tier', seat_tier: 'enterprise_standard' },
      amount: '31402.5',
    };
    expect(new Sanitizer().sanitize(value)).toEqual(value);
  });

  it('replaces names by kind but keeps the names of settings rows', () => {
    const s = new Sanitizer();
    const out = s.sanitize({
      member: { type: 'user', id: REAL_USER, name: 'Jane Doe', email: 'jane@corp-internal.io' },
      actor: {
        type: 'user_actor',
        user_id: REAL_USER,
        name: 'Jane Doe',
        email_address: 'jane@corp-internal.io',
      },
      group: { type: 'rbac_group', name: 'Platform Engineers', description: 'Our platform folks' },
      org: { uuid: REAL_ORG, name: 'Corp Platform' },
      key: { id: REAL_KEY, name: 'SIEM Export', scopes: ['read:x'] },
      setting: { name: 'sso_claude_ai_enforced', type: 'boolean', value: true },
    });
    expect(out.member.name).toBe('Synthetic User 1');
    expect(out.actor.name).toBe('Synthetic User 1');
    expect(out.group.name).toBe('Synthetic Group 1');
    expect(out.group.description).toBe('Synthetic description');
    expect(out.org.name).toBe('Synthetic Organization 1');
    expect(out.key.name).toBe('Synthetic Key 1');
    expect(out.setting.name).toBe('sso_claude_ai_enforced');
  });

  it('moves IP addresses into the documentation ranges, one-to-one', () => {
    const s = new Sanitizer();
    const out = s.sanitize({
      a: { ip_address: '203.0.113.41' },
      b: { ip_address: '203.0.113.41' },
      c: { ip_address: '10.20.30.40', user_agent: 'curl/8.0.1' },
      d: { ip_address: '2001:4860:4860::8888' },
      text: 'from 198.51.100.7 only',
    });
    expect(out.a.ip_address).toMatch(/^192\.0\.2\.\d{1,3}$/);
    expect(out.b.ip_address).toBe(out.a.ip_address);
    expect(out.c.ip_address).toMatch(/^192\.0\.2\./);
    expect(out.c.ip_address).not.toBe(out.a.ip_address);
    expect(out.c.user_agent).toBe('synthetic-agent/1.0');
    expect(out.d.ip_address).toBe('2001:db8::1');
    expect(out.text).toMatch(/^from 192\.0\.2\.\d+ only$/);
  });

  it('redacts key-like strings', () => {
    const out = new Sanitizer().sanitize({
      note: 'used sk-ant-api03-mock000000000000000000000000 today',
    });
    expect(out.note).toBe('used REDACTED_KEY today');
  });

  it('reports original values that survive in an output and none that were replaced', () => {
    const s = new Sanitizer();
    const input = { id: REAL_USER, email: 'jane@corp-internal.io', name: 'Jane Doe', type: 'user' };
    const out = JSON.stringify(s.sanitize(input));
    expect(s.residue(out)).toEqual([]);
    expect(s.residue(JSON.stringify(input)).sort()).toEqual(
      ['Jane Doe', 'jane@corp-internal.io', REAL_USER].sort(),
    );
    expect(s.stats()).toMatchObject({ emails: 1, ids: 1, names: 1 });
  });

  it('sanitizes every official example response without residue or foreign addresses', () => {
    const s = new Sanitizer();
    const outputs = Object.entries(FIXTURES).map(([path, handler]) => {
      const body = handler(new URL(`https://api.anthropic.com${path}`)).body;
      return JSON.stringify(s.sanitize({ path, body }));
    });
    for (const text of outputs) {
      expect(s.residue(text)).toEqual([]);
      for (const email of text.match(/[\w.+-]+@[\w.-]+/g) ?? []) {
        expect(email).toMatch(/^user\d+@example\.com$/);
      }
      expect(text).not.toContain('Acme');
    }
    // V2 is still reproducible: the key in the Activity Feed is the key in the inventory.
    const all = outputs.join('\n');
    const keyIds = new Set(all.match(/apikey_[A-Za-z0-9]+/g));
    expect(keyIds.size).toBe(1);
  });
});
