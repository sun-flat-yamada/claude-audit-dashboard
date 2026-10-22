import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Workflows whose steps load the collector configuration (#156). */
const CONFIG_LOADING_WORKFLOWS = [
  'collect-audit.yml',
  'weekly-report.yml',
  'monthly-report.yml',
  'ack-alert.yml',
];

describe('AUDIT_CONFIG_OVERRIDES wiring', () => {
  it('passes the repository variable at job level to every configuration-loading workflow', () => {
    for (const name of CONFIG_LOADING_WORKFLOWS) {
      const workflow = readFileSync(join('.github/workflows', name), 'utf8');
      const job = workflow.slice(workflow.indexOf('\njobs:'), workflow.indexOf('    steps:\n'));
      assert.match(
        job,
        /\n {4}env:\n {6}AUDIT_CONFIG_OVERRIDES: \$\{\{ vars\.AUDIT_CONFIG_OVERRIDES \}\}\n/,
        name,
      );
    }
  });
});
