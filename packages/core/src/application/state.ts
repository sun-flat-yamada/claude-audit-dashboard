import { z } from 'zod';

export const STATE_SCHEMA_VERSION = 2;

/**
 * Persisted between runs. Cursors and projection states are opaque here: each collector
 * or projection validates its own entry, so adding one never changes this schema.
 */
const stateSchema = z.object({
  schemaVersion: z.literal(STATE_SCHEMA_VERSION),
  collections: z.object({
    count: z.number().int().nonnegative(),
    lastAt: z.string().nullable(),
  }),
  cursors: z.record(z.string(), z.unknown()),
  projections: z.record(z.string(), z.unknown()),
  notifications: z.object({
    lastSent: z.record(z.string(), z.string()),
    /**
     * Send records (F-008), added without a version bump: optional, so older files still parse.
     * Entries are validated one by one by `parseSentRecords`, so a bad record never resets state.
     */
    history: z.array(z.unknown()).default([]),
  }),
});

export type CollectorState = z.infer<typeof stateSchema>;

export const initialState = (): CollectorState => ({
  schemaVersion: STATE_SCHEMA_VERSION,
  collections: { count: 0, lastAt: null },
  cursors: {},
  projections: {},
  notifications: { lastSent: {}, history: [] },
});

/** Unknown or older (v1) state starts over instead of being misread. */
export const parseState = (raw: unknown): CollectorState => {
  const parsed = stateSchema.safeParse(raw);
  return parsed.success ? parsed.data : initialState();
};
