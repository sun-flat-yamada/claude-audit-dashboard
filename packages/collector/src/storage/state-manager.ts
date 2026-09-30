import type { CollectorState } from '@claude-audit/shared';
import type { FileStore } from './file-store.js';

const STATE_PATH = 'state.json';

export const INITIAL_STATE: CollectorState = {
  last_collection_at: null,
  last_activity_id: null,
  collection_count: 0,
};

/** Persists collector state (incremental cursor, run count) via the file store. */
export class StateManager {
  constructor(private readonly store: FileStore) {}

  async load(): Promise<CollectorState> {
    return {
      ...INITIAL_STATE,
      ...(await this.store.readJson<Partial<CollectorState>>(STATE_PATH)),
    };
  }

  async save(state: CollectorState): Promise<void> {
    await this.store.writeJson(STATE_PATH, state);
  }
}
