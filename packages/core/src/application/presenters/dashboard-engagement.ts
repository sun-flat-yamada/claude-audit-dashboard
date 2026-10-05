import type { DashboardEngagement } from '../../contracts/dashboard-view.js';
import {
  ACTIVE_USER_PRODUCTS,
  CODE_TOOLS,
  type ActiveUserProduct,
  type MemberActivity,
  type MemberEngagement,
  type ToolDecisions,
} from '../../domain/model/entities.js';
import { percent } from '../../domain/util/numbers.js';

/** A product block of {@link MemberEngagement}; its numeric fields are the counters. */
type Counters = object;

const valueOf = (block: Counters, field: string): unknown =>
  (block as Readonly<Record<string, unknown>>)[field];

interface ProductSpec {
  product: ActiveUserProduct;
  block: (e: MemberEngagement) => Counters | undefined;
  messages: string | null;
  sessions: string | null;
  counters: readonly (readonly [field: string, label: string])[];
}

/** Main counters per product (domain field, display label); order is the catalog order. */
const PRODUCT_SPECS: readonly ProductSpec[] = [
  {
    product: 'chat',
    block: (e) => e.chat,
    messages: 'messages',
    sessions: null,
    counters: [
      ['conversations', 'Conversations'],
      ['projectsCreated', 'Projects created'],
      ['artifactsCreated', 'Artifacts created'],
      ['filesUploaded', 'Files uploaded'],
    ],
  },
  {
    product: 'claude_code',
    block: (e) => e.claudeCode && { ...e.claudeCode, tools: undefined },
    messages: null,
    sessions: 'sessions',
    counters: [
      ['commits', 'Commits'],
      ['pullRequests', 'Pull requests'],
      ['addedLines', 'Lines added'],
      ['removedLines', 'Lines removed'],
    ],
  },
  {
    product: 'cowork',
    block: (e) => e.cowork,
    messages: 'messages',
    sessions: 'sessions',
    counters: [
      ['actions', 'Actions'],
      ['dispatchTurns', 'Dispatch turns'],
      ['artifactsCreated', 'Artifacts created'],
    ],
  },
  {
    product: 'claude_design',
    block: (e) => e.design,
    messages: 'messages',
    sessions: 'sessions',
    counters: [['projectsCreated', 'Projects created']],
  },
  {
    product: 'office_agent',
    block: (e) => e.office,
    messages: 'messages',
    sessions: 'sessions',
    counters: [
      ['skillCalls', 'Skill calls'],
      ['connectorCalls', 'Connector calls'],
    ],
  },
  {
    product: 'science',
    block: (e) => e.science,
    messages: 'messages',
    sessions: 'sessions',
    counters: [
      ['delegations', 'Delegations'],
      ['computeJobs', 'Remote compute jobs'],
    ],
  },
];

const LABEL = new Map<string, string>(ACTIVE_USER_PRODUCTS.map((p) => [p.product, p.label]));

/** Sum of the reported values; null when none was reported. */
function sumOf(values: readonly (number | null | undefined)[]): number | null {
  const known = values.filter((v): v is number => typeof v === 'number');
  return known.length === 0 ? null : known.reduce((a, b) => a + b, 0);
}

const positive = (counters: Counters): boolean =>
  Object.values(counters).some((v) => typeof v === 'number' && v > 0);

const numberOrNull = (value: unknown): number | null => (typeof value === 'number' ? value : null);

const toolActive = (e: MemberEngagement): boolean =>
  Object.values(e.claudeCode?.tools ?? {}).some((t) => t.accepted + t.rejected > 0);

const isActive = (spec: ProductSpec, e: MemberEngagement, block: Counters): boolean =>
  positive(block) || (spec.product === 'claude_code' && toolActive(e));

function productRow(spec: ProductSpec, rows: readonly MemberEngagement[]) {
  const reported = rows.flatMap((e) => {
    const block = spec.block(e);
    return block ? [{ e, block }] : [];
  });
  if (reported.length === 0) return [];
  const total = (field: string | null) =>
    field === null ? null : sumOf(reported.map(({ block }) => numberOrNull(valueOf(block, field))));
  return [
    {
      product: spec.product,
      label: LABEL.get(spec.product) ?? spec.product,
      activeMembers: reported.filter(({ e, block }) => isActive(spec, e, block)).length,
      messages: total(spec.messages),
      sessions: total(spec.sessions),
      counters: spec.counters.map(([key, label]) => ({ key, label, value: total(key) })),
    },
  ];
}

const decisions = (accepted: number, rejected: number) => ({
  accepted,
  rejected,
  acceptRate: accepted + rejected === 0 ? null : percent(accepted, accepted + rejected),
});

function toolRows(rows: readonly MemberEngagement[]) {
  return CODE_TOOLS.flatMap(({ tool, label }) => {
    const reported = rows.flatMap((e) => {
      const t: ToolDecisions | undefined = e.claudeCode?.tools[tool];
      return t ? [t] : [];
    });
    if (reported.length === 0) return [];
    const accepted = reported.reduce((n, t) => n + t.accepted, 0);
    const rejected = reported.reduce((n, t) => n + t.rejected, 0);
    return [{ tool, label, ...decisions(accepted, rejected) }];
  });
}

function claudeCode(rows: readonly MemberEngagement[]): DashboardEngagement['claudeCode'] {
  const code = rows.flatMap((e) => (e.claudeCode ? [e.claudeCode] : []));
  if (code.length === 0) return null;
  const tools = toolRows(rows);
  const total = (pick: (c: (typeof code)[number]) => number | null) => sumOf(code.map(pick));
  return {
    ...decisions(
      tools.reduce((n, t) => n + t.accepted, 0),
      tools.reduce((n, t) => n + t.rejected, 0),
    ),
    sessions: total((c) => c.sessions),
    commits: total((c) => c.commits),
    pullRequests: total((c) => c.pullRequests),
    addedLines: total((c) => c.addedLines),
    removedLines: total((c) => c.removedLines),
    tools,
  };
}

const ORDER = new Map<string, number>(PRODUCT_SPECS.map((s, i) => [s.product, i]));

/**
 * Product engagement summed over the members' activity rows (no per-person values): members
 * active per product, summed main counters, and Claude Code lines, commits, pull requests and
 * suggestion accept rate. Undefined when no row carries engagement.
 */
export function productEngagement(
  activity: readonly MemberActivity[],
  window: DashboardEngagement['window'],
): DashboardEngagement | undefined {
  const rows = activity.flatMap((a) => (a.engagement ? [a.engagement] : []));
  if (rows.length === 0) return undefined;
  const products = PRODUCT_SPECS.flatMap((spec) => productRow(spec, rows)).sort(
    (a, b) =>
      b.activeMembers - a.activeMembers ||
      (ORDER.get(a.product) ?? 0) - (ORDER.get(b.product) ?? 0),
  );
  return {
    window,
    members: rows.length,
    products,
    claudeCode: claudeCode(rows),
    webSearches: sumOf(rows.map((e) => e.webSearches)),
  };
}
