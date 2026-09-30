import { describe, expect, it } from 'vitest';
import { PluginRegistry } from '../registry.js';

describe('PluginRegistry', () => {
  it('registers, gets and lists; rejects duplicates', () => {
    const r = new PluginRegistry<{ id: string }>().register({ id: 'a' }).register({ id: 'b' });
    expect(r.get('a')).toEqual({ id: 'a' });
    expect(r.list()).toHaveLength(2);
    expect(() => r.register({ id: 'a' })).toThrow(/already registered/);
  });
});
