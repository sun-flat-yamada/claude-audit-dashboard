import { describe, expect, it } from 'vitest';
import { formatHash, matchPath, parseHash, parseHashQuery } from '../router';

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

  it.each([
    ['', {}],
    ['#/compare', {}],
    ['#/compare?', {}],
    ['#/compare?base=a&target=b', { base: 'a', target: 'b' }],
    ['/compare?base=a', { base: 'a' }],
    ['#/compare?base=a&base=b', { base: 'a' }],
    ['#/compare?base=2026-09-01T12-00-00Z&x=1&y', { base: '2026-09-01T12-00-00Z', x: '1', y: '' }],
    ['#/compare?base=a%20b&target=%E0%A4%A', { base: 'a b', target: '\uFFFD%A' }],
    ['#/compare?=x&base=y', { base: 'y' }],
  ])('parseHashQuery(%j) = %j', (hash, query) => {
    expect(parseHashQuery(hash)).toEqual(query);
  });

  it('keeps the path unchanged when a query is present', () => {
    expect(parseHash('#/compare?base=a&target=b')).toBe('/compare');
    expect(matchPath('/compare', parseHash('#/compare?base=a'))).toEqual({});
  });

  it('formatHash serializes the query and round-trips it', () => {
    expect(formatHash('/compare', { base: 'a', target: 'b' })).toBe('#/compare?base=a&target=b');
    expect(formatHash('/compare', { base: '', target: 'b' })).toBe('#/compare?target=b');
    expect(formatHash('/compare', {})).toBe('#/compare');
    const query = { base: 'a b&c', target: 'x=y' };
    const hash = formatHash('/compare', query);
    expect(parseHash(hash)).toBe('/compare');
    expect(parseHashQuery(hash)).toEqual(query);
  });
});
