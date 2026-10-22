import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEMO_NOW, createDemoCollectors } from '../../adapters/demo/demo-source.js';
import { fixedClock, silentLogger } from '../../infrastructure/runtime.js';
import { configViewInput } from '../config-view.js';
import { createContainer } from '../container.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'overrides-view-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('effective configuration view', () => {
  it('reflects the overrides passed through the environment', async () => {
    const c = await createContainer({
      env: {
        AUDIT_CONFIG_OVERRIDES: JSON.stringify({
          sources: { activities: { excludeTypes: [] }, featureUsage: { enabled: true } },
        }),
      },
      cwd: dir,
      dataDir: dir,
      clock: fixedClock(DEMO_NOW),
      collectors: createDemoCollectors(),
      logger: silentLogger,
      source: 'demo',
    });
    const view = configViewInput(c);
    expect(view.activities.excludedTypeCount).toBe(0);
    expect(view.enabledOptionalDatasets).toEqual(
      expect.arrayContaining(['skillUsage', 'connectorUsage', 'pluginUsage', 'chatProjectUsage']),
    );
  });
});
