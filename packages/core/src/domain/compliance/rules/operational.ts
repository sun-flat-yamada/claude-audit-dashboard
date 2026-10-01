import { z } from 'zod';
import type { DatasetMeta } from '../../model/dataset.js';
import { round } from '../../util/numbers.js';
import { HOUR_MS } from '../../util/time.js';
import { defineRule } from '../define-rule.js';
import { fail, failIfAny, pass, skip } from '../types.js';

export const collectionFreshness = defineRule({
  meta: {
    id: 'OP-001',
    name: 'Collection Freshness',
    category: 'operational',
    severity: 'high',
    description: 'Time since the evaluated snapshot was collected',
    remediation:
      'Check the collect-audit workflow runs, secrets and the ENABLE_SCHEDULED_JOBS variable.',
  },
  requires: [],
  params: z.object({ maxStaleHours: z.number().positive().default(24) }),
  evaluate({ snapshot, params, now }) {
    const hours = round((now.getTime() - Date.parse(snapshot.collectedAt)) / HOUR_MS, 1);
    if (hours > params.maxStaleHours) {
      return fail(`Last collection ${hours}h ago (max ${params.maxStaleHours}h)`);
    }
    return pass(`Last collection ${hours}h ago`);
  },
});

export const dataSourceCoverage = defineRule({
  meta: {
    id: 'OP-002',
    name: 'Data Source Coverage',
    category: 'operational',
    severity: 'high',
    description:
      'Datasets that could not be collected (missing key or scope, disabled API, API error or schema drift)',
    remediation:
      'Grant the scopes listed in docs/SETUP.md, enable the API in claude.ai, or disable the data source in config.',
  },
  requires: [],
  params: z.object({ ignore: z.array(z.string()).default([]) }),
  evaluate({ coverage, params }) {
    const entries = Object.entries(coverage) as [string, DatasetMeta][];
    if (entries.length === 0) return skip('No data source is configured');
    return failIfAny(
      entries.filter(([name, meta]) => meta.status !== 'ok' && !params.ignore.includes(name)),
      {
        pass: `All ${entries.length} datasets collected`,
        fail: (n) => `${n} of ${entries.length} dataset(s) not collected`,
      },
      ([name, meta]) => ({
        kind: 'dataset',
        id: name,
        label: `${meta.status}: ${meta.reason ?? 'no reason reported'}`,
      }),
    );
  },
});

export const operationalRules = [collectionFreshness, dataSourceCoverage];
