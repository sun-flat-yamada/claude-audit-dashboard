import type { ApiKeyInfo, OrganizationMember, Workspace } from '@claude-audit/shared';

export interface OrgSource {
  listMembers(): Promise<OrganizationMember[]>;
  listWorkspaces(): Promise<Workspace[]>;
  listApiKeys(): Promise<ApiKeyInfo[]>;
}

export interface OrgData {
  members: OrganizationMember[];
  workspaces: Workspace[];
  api_keys: ApiKeyInfo[];
}

/** Collects members, workspaces and API keys from the Admin API. */
export async function collectOrg(source: OrgSource): Promise<OrgData> {
  const [members, workspaces, api_keys] = await Promise.all([
    source.listMembers(),
    source.listWorkspaces(),
    source.listApiKeys(),
  ]);
  return { members, workspaces, api_keys };
}
