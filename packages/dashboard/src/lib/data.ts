import { DASHBOARD_VIEW_SCHEMA_VERSION, type DashboardView } from '@claude-audit/core/contracts';

export type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; view: DashboardView };

/** Minimal runtime guard: the collector validates the full contract when it writes the file. */
export function asDashboardView(value: unknown): DashboardView {
  const version = (value as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (version !== DASHBOARD_VIEW_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported dashboard data (schemaVersion ${String(version)}; expected ${DASHBOARD_VIEW_SCHEMA_VERSION}). Re-run \`pnpm build:data\` or \`pnpm demo\`.`,
    );
  }
  return value as DashboardView;
}

export async function loadDashboard(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DashboardView> {
  const response = await fetchImpl(`${baseUrl}data/dashboard.json`);
  if (!response.ok) throw new Error(`HTTP ${response.status} while loading data/dashboard.json`);
  return asDashboardView(await response.json());
}
