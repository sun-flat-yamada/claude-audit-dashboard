import { z } from 'zod';
import type { Projection } from './projection.js';

const stateSchema = z.object({
  observedSince: z.string(),
  lastSeen: z.record(z.string(), z.string()),
});

const later = (a: string | undefined, b: string): string => (a && a > b ? a : b);

/** Last time each key called the Compliance API, from `api_actor` activities. */
export const credentialUsageProjection: Projection<'credentialUsage'> = {
  dataset: 'credentialUsage',
  requires: ['activities'],
  reduce({ previous, data, now }) {
    const parsed = stateSchema.safeParse(previous);
    const state = parsed.success
      ? { observedSince: parsed.data.observedSince, lastSeen: { ...parsed.data.lastSeen } }
      : { observedSince: now.toISOString(), lastSeen: {} as Record<string, string> };
    for (const activity of data.activities) {
      const keyId = activity.actor.kind === 'api_actor' ? activity.actor.id : null;
      if (keyId) state.lastSeen[keyId] = later(state.lastSeen[keyId], activity.createdAt);
    }
    return {
      state,
      items: Object.entries(state.lastSeen).map(([credentialId, lastSeenAt]) => ({
        credentialId,
        lastSeenAt,
      })),
      window: { from: state.observedSince, to: now.toISOString() },
    };
  },
};
