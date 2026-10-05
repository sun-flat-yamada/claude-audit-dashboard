import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { alertId, parseAckStore } from '@claude-audit/core';
import { checkDetailBundle, detailAlertsSchema } from '@claude-audit/core/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOCK_KEY, fakeAnthropic } from '../../__tests__/fake-anthropic.js';
import { FsAckRepository } from '../../adapters/storage/ack-store.js';
import { FileStore } from '../../adapters/storage/file-store.js';
import { fixedClock } from '../../infrastructure/runtime.js';
import { runCli } from '../cli.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'alerts-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });
const NOW = new Date('2026-09-30T12:00:00Z');
function options(env: Record<string, string> = {}, fetchImpl?: typeof fetch, now = NOW) {
  return {
    env: { CONFIG_DIR: join(dir, 'no-config'), ...env },
    cwd: dir,
    dataDir: join(dir, 'data'),
    clock: fixedClock(now),
    logger: logger(),
    fetchImpl,
  };
}

const ackFile = () => join(dir, 'data/alerts/ack.json');
const readState = async () =>
  JSON.parse(await readFile(join(dir, 'data/state.json'), 'utf8')) as {
    notifications: { lastSent: Record<string, string>; history: { key: string; sentAt: string }[] };
  };
const readAlerts = async () =>
  detailAlertsSchema.parse(
    JSON.parse(await readFile(join(dir, 'data/detail/alerts.json'), 'utf8')),
  );

/** Runs the pipeline and sends the alert digest, which records the send in state.json. */
async function sendOne() {
  const api = fakeAnthropic();
  const opts = options({ ANTHROPIC_ENTERPRISE_API_KEY: MOCK_KEY }, api.fetch);
  expect(await runCli(['pipeline'], opts)).toBe(0);
  expect(await runCli(['notify'], opts)).toBe(0);
  const { history } = (await readState()).notifications;
  expect(history).toHaveLength(1);
  const [record] = history;
  return alertId(record?.key ?? '', record?.sentAt ?? '');
}

describe('FsAckRepository', () => {
  const repo = () => new FsAckRepository(new FileStore(join(dir, 'data')));

  it('reads a missing file as an empty store', async () => {
    expect(await repo().load()).toEqual({
      store: { schemaVersion: 1, acks: [] },
      status: 'missing',
    });
  });

  it.each([
    ['not JSON', '{nope'],
    ['an unknown version', JSON.stringify({ schemaVersion: 9, acks: [] })],
    ['a bad shape', JSON.stringify({ schemaVersion: 1, acks: [{ alertId: 'x' }] })],
  ])('reads %s as empty and corrupt', async (_name, content) => {
    await mkdir(join(dir, 'data/alerts'), { recursive: true });
    await writeFile(ackFile(), content);
    expect(await repo().load()).toEqual({
      store: { schemaVersion: 1, acks: [] },
      status: 'corrupt',
    });
  });

  it('writes atomically and deterministically, and reads back what it wrote', async () => {
    const store = {
      schemaVersion: 1 as const,
      acks: [{ alertId: 'al_0123456789ab', at: '2026-09-30T00:00:00.000Z', by: 'ops' }],
    };
    await repo().save(store);
    const first = await readFile(ackFile(), 'utf8');
    await repo().save(store);
    expect(await readFile(ackFile(), 'utf8')).toBe(first);
    expect(first.endsWith('\n')).toBe(true);
    expect(await repo().load()).toEqual({ store, status: 'ok' });
    expect(parseAckStore(JSON.parse(first)).valid).toBe(true);
    await expect(readFile(`${ackFile()}.tmp`)).rejects.toThrow();
  });
});

describe('notify records the send', () => {
  it('appends the alert to the state history with its channel, and keeps lastSent', async () => {
    await sendOne();
    const { history, lastSent } = (await readState()).notifications;
    expect(history[0]).toMatchObject({
      key: expect.stringMatching(/^compliance:/),
      channels: ['console'],
      severity: expect.any(String),
    });
    // The history and the cooldown entry share the send time (no legacy duplicate).
    expect(lastSent[history[0]?.key ?? '']).toBe(history[0]?.sentAt);
  });

  it('a second notify within the cooldown sends and records nothing more', async () => {
    const api = fakeAnthropic();
    const opts = options({ ANTHROPIC_ENTERPRISE_API_KEY: MOCK_KEY }, api.fetch);
    await runCli(['pipeline'], opts);
    await runCli(['notify'], opts);
    await runCli(['notify'], opts);
    expect((await readState()).notifications.history).toHaveLength(1);
  });

  it('records a collection failure alert too', async () => {
    const opts = options();
    await runCli(['pipeline'], opts);
    expect(await runCli(['notify', '--collect-status', 'failure'], opts)).toBe(0);
    const keys = (await readState()).notifications.history.map((h) => h.key);
    expect(keys).toContain('collection:failure');
  });
});

describe('alerts ack', () => {
  it('acknowledges a sent alert and the detail file shows it', async () => {
    const id = await sendOne();
    const opts = options({}, undefined, new Date('2026-09-30T15:00:00Z'));
    expect(await runCli(['alerts', 'ack', id, '--by', 'platform-ops'], opts)).toBe(0);
    expect(opts.logger.info).toHaveBeenCalledWith(`Alert ${id} acknowledged`);
    const stored = JSON.parse(await readFile(ackFile(), 'utf8')) as { acks: unknown[] };
    expect(stored.acks).toEqual([
      { alertId: id, at: '2026-09-30T15:00:00.000Z', by: 'platform-ops' },
    ]);
    expect(await runCli(['detail'], opts)).toBe(0);
    const alerts = await readAlerts();
    expect(alerts.alerts).toHaveLength(1);
    expect(alerts.alerts[0]).toMatchObject({
      id,
      acknowledged: true,
      acknowledgedBy: 'platform-ops',
      channels: ['console'],
    });
    expect(alerts.totals).toEqual({ alerts: 1, acknowledged: 1, unacknowledged: 0 });
  });

  it('a duplicate acknowledgement keeps the first one and succeeds', async () => {
    const id = await sendOne();
    expect(await runCli(['alerts', 'ack', id, '--by', 'first'], options())).toBe(0);
    const before = await readFile(ackFile(), 'utf8');
    const opts = options({}, undefined, new Date('2026-10-01T00:00:00Z'));
    expect(await runCli(['alerts', 'ack', id, '--by', 'second'], opts)).toBe(0);
    expect(opts.logger.info).toHaveBeenCalledWith(`Alert ${id} was already acknowledged`);
    expect(await readFile(ackFile(), 'utf8')).toBe(before);
  });

  it('rejects an unknown alert id and a malformed one without writing', async () => {
    await sendOne();
    const unknown = options();
    expect(await runCli(['alerts', 'ack', 'al_000000000000'], unknown)).toBe(1);
    expect(unknown.logger.error).toHaveBeenCalledWith(expect.stringContaining('Unknown alert'));
    const bad = options();
    expect(await runCli(['alerts', 'ack', 'not-an-id'], bad)).toBe(1);
    expect(bad.logger.error).toHaveBeenCalledWith(expect.stringContaining('Invalid alert id'));
    await expect(readFile(ackFile())).rejects.toThrow();
  });

  it('fails with usage for missing arguments', async () => {
    for (const args of [
      ['alerts'],
      ['alerts', 'ack'],
      ['alerts', 'ack', '--by', 'x'],
      ['alerts', 'nope', 'al_0'],
    ]) {
      const opts = options();
      expect(await runCli(args, opts)).toBe(1);
      expect(opts.logger.error).toHaveBeenCalledWith(expect.stringContaining('Usage: alerts ack'));
    }
    const id = await sendOne();
    const noLabel = options();
    expect(await runCli(['alerts', 'ack', id, '--by'], noLabel)).toBe(1);
    expect(noLabel.logger.error).toHaveBeenCalledWith('--by requires a label');
  });

  it('refuses to overwrite a corrupt acknowledgement file', async () => {
    const id = await sendOne();
    await mkdir(join(dir, 'data/alerts'), { recursive: true });
    await writeFile(ackFile(), '{broken');
    const opts = options();
    expect(await runCli(['alerts', 'ack', id], opts)).toBe(1);
    expect(opts.logger.error).toHaveBeenCalledWith(expect.stringContaining('unreadable'));
    expect(await readFile(ackFile(), 'utf8')).toBe('{broken');
  });

  it('hides an e-mail or URL label before it is stored or published', async () => {
    const id = await sendOne();
    expect(await runCli(['alerts', 'ack', id, '--by', 'jane.doe@corp.example'], options())).toBe(0);
    expect(await readFile(ackFile(), 'utf8')).not.toContain('@');
    const opts = options();
    await runCli(['detail'], opts);
    const text = await readFile(join(dir, 'data/detail/alerts.json'), 'utf8');
    expect(text).toContain('[hidden]');
    expect(text).not.toMatch(/@|https?:/);
  });
});

describe('detail alerts file', () => {
  it('publishes an empty history when nothing was sent, and a valid bundle', async () => {
    const opts = options();
    expect(await runCli(['detail'], opts)).toBe(0);
    expect((await readAlerts()).alerts).toEqual([]);
    const files = {
      'detail/index.json': await readFile(join(dir, 'data/detail/index.json'), 'utf8'),
      'detail/alerts.json': await readFile(join(dir, 'data/detail/alerts.json'), 'utf8'),
    };
    expect(checkDetailBundle(files).filter((e) => e.startsWith('detail/alerts'))).toEqual([]);
  });

  it('lists a send that only exists in lastSent (older state) as an unknown-severity alert', async () => {
    await mkdir(join(dir, 'data'), { recursive: true });
    await writeFile(
      join(dir, 'data/state.json'),
      JSON.stringify({
        schemaVersion: 2,
        collections: { count: 0, lastAt: null },
        cursors: {},
        projections: {},
        notifications: { lastSent: { 'compliance:AC-001=fail': '2026-09-29T00:00:00.000Z' } },
      }),
    );
    expect(await runCli(['detail'], options())).toBe(0);
    const [alert] = (await readAlerts()).alerts;
    expect(alert).toMatchObject({ severity: 'unknown', channels: [], kind: 'compliance' });
  });
});
