import {
  DETAIL_MANIFEST_PATH,
  DETAIL_ORG_GROUPS_PATH,
  detailManifestSchema,
  detailOrgGroupsSchema,
  type DetailManifest,
  type DetailOrgGroups,
} from '@claude-audit/core/contracts';
import { detailNotice } from '../components/DetailControls';
import { useDetailFile, type DetailState } from '../lib/detail-data';

export interface DrilldownOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

const SUBJECT = {
  kind: 'org-groups',
  plural: 'organizations and groups',
  title: 'Organization and group',
} as const;

export interface OrgGroupsLoad {
  file: DetailState<DetailOrgGroups>;
  manifest: DetailState<DetailManifest>;
  notice: ReturnType<typeof detailNotice>;
}

/** Loads `detail/org-groups.json` and the manifest (for the "not collected" reason). */
export function useOrgGroups(options: DrilldownOptions): OrgGroupsLoad {
  const file = useDetailFile(DETAIL_ORG_GROUPS_PATH, detailOrgGroupsSchema, options);
  const manifest = useDetailFile(DETAIL_MANIFEST_PATH, detailManifestSchema, options);
  return { file, manifest, notice: detailNotice(file, manifest, SUBJECT) };
}
