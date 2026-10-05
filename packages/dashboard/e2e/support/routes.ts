import type { APIRequestContext } from '@playwright/test';

/** Hash routes of `src/routes.tsx` without parameters, with the heading each one renders. */
export const STATIC_ROUTES = [
  { path: '/', heading: 'Claude Enterprise Audit Dashboard' },
  { path: '/compliance', heading: 'Compliance results' },
  { path: '/members', heading: 'Members' },
  { path: '/keys', heading: 'API keys' },
  { path: '/activity', heading: 'Activity' },
  { path: '/reports/monthly', heading: 'Monthly cost report' },
  { path: '/models', heading: 'Models' },
  { path: '/config', heading: 'Configuration' },
  { path: '/archive', heading: 'Archive' },
  { path: '/alerts', heading: 'Alerts' },
  { path: '/orgs', heading: 'Organizations' },
] as const;

export interface Ids {
  orgs: string[];
  groups: string[];
  months: string[];
}

/** Reads a published detail file; `undefined` when the profile has no such file. */
async function readJson(request: APIRequestContext, path: string): Promise<unknown> {
  const response = await request.get(path);
  return response.ok() ? await response.json() : undefined;
}

const idsOf = (value: unknown, key: string): string[] => {
  const rows = (value as Record<string, unknown> | undefined)?.[key];
  return Array.isArray(rows) ? rows.map((row) => String((row as { id: unknown }).id)) : [];
};

/** Ids of the organizations, groups and monthly reports present in the profile's data. */
export async function discoverIds(request: APIRequestContext): Promise<Ids> {
  const orgGroups = await readJson(request, 'data/detail/org-groups.json');
  const monthly = await readJson(request, 'data/detail/monthly/index.json');
  return {
    orgs: idsOf(orgGroups, 'organizations'),
    groups: idsOf(orgGroups, 'groups'),
    months: idsOf(monthly, 'reports'),
  };
}

/** A screen of the app; parametrised ones use the first id of the profile's data. */
export interface Screen {
  name: string;
  path: (ids: Ids) => string;
}

/**
 * Every route of `src/routes.tsx`: the static ones plus one detail page per kind (the first id
 * found, or a placeholder id that must render the "not found" notice).
 */
export const SCREENS: Screen[] = [
  ...STATIC_ROUTES.map((r) => ({ name: r.path, path: () => r.path })),
  {
    name: '/reports/monthly/:id',
    path: (ids) => `/reports/monthly/${ids.months[0] ?? 'monthly-2000-01'}`,
  },
  { name: '/orgs/:id', path: (ids) => `/orgs/${ids.orgs[0] ?? 'unknown-org'}` },
  { name: '/groups/:id', path: (ids) => `/groups/${ids.groups[0] ?? 'unknown-group'}` },
];
