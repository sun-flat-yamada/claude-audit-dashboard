import { describe, expect, it } from 'vitest';
import { formatHash, matchPath, parseHash } from '../router';

describe('hash router helpers', () => {
  it.each([
    ['', '/'],
    ['#', '/'],
    ['#/', '/'],
    ['#/members', '/members'],
    ['#/members/', '/members'],
    ['#/reports/monthly/2026-09', '/reports/monthly/2026-09'],
    ['#/orgs/a%20b', '/orgs/a b'],
    ['#/members?q=x', '/members'],
    ['#/bad%E0%A4%A', '/bad%E0%A4%A'],
  ])('parseHash(%j) = %j', (hash, path) => {
    expect(parseHash(hash)).toBe(path);
  });

  it('formatHash is the inverse of parseHash', () => {
    for (const path of ['/', '/members', '/orgs/a b', '/reports/monthly/2026-09']) {
      expect(parseHash(formatHash(path))).toBe(path);
    }
    expect(formatHash('/')).toBe('#/');
  });

  it('matchPath extracts params and rejects other shapes', () => {
    expect(matchPath('/reports/monthly/:id', '/reports/monthly/2026-09')).toEqual({
      id: '2026-09',
    });
    expect(matchPath('/members', '/members')).toEqual({});
    expect(matchPath('/members', '/keys')).toBeNull();
    expect(matchPath('/orgs/:id', '/orgs')).toBeNull();
  });
});
