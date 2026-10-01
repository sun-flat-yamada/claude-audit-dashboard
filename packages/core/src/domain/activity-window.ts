import { z } from 'zod';
import type { Activity } from './model/entities.js';
import { uniqueBy } from './util/collections.js';
import { HOUR_MS, addMinutes } from './util/time.js';

/**
 * Window polling for the Compliance Activity Feed, as recommended by Anthropic:
 * query [from, to) with `to` a little in the past, overlap consecutive windows and
 * de-duplicate by activity id (the feed is at-least-once).
 */
export const activityCursorSchema = z.object({
  windowStart: z.string(),
  recentIds: z.array(z.string()),
});

export type ActivityCursor = z.infer<typeof activityCursorSchema>;

export interface ActivityWindowConfig {
  initialLookbackHours: number;
  overlapMinutes: number;
  lagMinutes: number;
}

export interface ActivityWindow {
  from: Date;
  to: Date;
}

export function nextActivityWindow(
  cursor: ActivityCursor | null,
  now: Date,
  config: ActivityWindowConfig,
): ActivityWindow | null {
  const to = addMinutes(now, -config.lagMinutes);
  const from = cursor
    ? addMinutes(new Date(cursor.windowStart), -config.overlapMinutes)
    : new Date(now.getTime() - config.initialLookbackHours * HOUR_MS);
  return to > from ? { from, to } : null;
}

/** Drops activities already delivered in the overlap and returns the cursor for the next run. */
export function advanceActivityWindow(
  fetched: readonly Activity[],
  cursor: ActivityCursor | null,
  window: ActivityWindow,
  config: ActivityWindowConfig,
): { items: Activity[]; cursor: ActivityCursor } {
  const unique = uniqueBy(fetched, (a) => a.id);
  const delivered = new Set(cursor?.recentIds ?? []);
  const keepFrom = addMinutes(window.to, -config.overlapMinutes);
  return {
    items: unique.filter((a) => !delivered.has(a.id)),
    cursor: {
      windowStart: window.to.toISOString(),
      recentIds: unique.filter((a) => new Date(a.createdAt) >= keepFrom).map((a) => a.id),
    },
  };
}
