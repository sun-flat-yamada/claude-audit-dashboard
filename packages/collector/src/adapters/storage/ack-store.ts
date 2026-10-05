import { ACK_STORE_PATH, ackStoreSchema, parseAckStore, type AckStore } from '@claude-audit/core';
import type { FileStore } from './file-store.js';

export interface LoadedAcks {
  store: AckStore;
  /** `missing`: no file yet. `corrupt`: unreadable, not JSON, an unknown version or a bad shape. */
  status: 'ok' | 'missing' | 'corrupt';
}

/**
 * Acknowledgements of sent alerts (`alerts/ack.json` in the data directory, i.e. on the
 * `data/audit` branch). Reads are tolerant (anything unusable reads as an empty store, with the
 * reason in `status`); writes are atomic and deterministic (sorted keys, one trailing newline).
 */
export class FsAckRepository {
  constructor(
    private readonly store: FileStore,
    private readonly file = ACK_STORE_PATH,
  ) {}

  async load(): Promise<LoadedAcks> {
    let raw: unknown;
    try {
      raw = await this.store.readJson(this.file);
    } catch {
      return { store: parseAckStore(undefined).store, status: 'corrupt' };
    }
    if (raw === null) return { store: parseAckStore(undefined).store, status: 'missing' };
    const { store, valid } = parseAckStore(raw);
    return { store, status: valid ? 'ok' : 'corrupt' };
  }

  save(store: AckStore): Promise<void> {
    return this.store.writeJson(this.file, ackStoreSchema.parse(store));
  }
}
