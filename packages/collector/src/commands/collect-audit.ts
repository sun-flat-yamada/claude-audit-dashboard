import { pathToFileURL } from 'node:url';
import { AdminApi } from '../api/admin.js';
import { ComplianceApi } from '../api/compliance.js';
import { collectSnapshot } from '../collectors/snapshot.js';
import { loadConfig } from '../config.js';
import { FileStore } from '../storage/file-store.js';
import { StateManager } from '../storage/state-manager.js';

export async function main(): Promise<void> {
  const config = loadConfig();
  const store = new FileStore(config.dataDir);
  const snapshot = await collectSnapshot({
    org: new AdminApi({ apiKey: config.adminApiKey }),
    activities: config.complianceApiKey
      ? new ComplianceApi({ apiKey: config.complianceApiKey })
      : null,
    store,
    state: new StateManager(store),
    organizationId: config.organizationId,
  });
  if (!config.complianceApiKey) {
    console.warn('ANTHROPIC_COMPLIANCE_API_KEY not set: activities were not collected');
  }
  console.log(
    `Collected ${snapshot.members.length} members, ${snapshot.workspaces.length} workspaces, ` +
      `${snapshot.api_keys.length} API keys, ${snapshot.activities.length} activities`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
