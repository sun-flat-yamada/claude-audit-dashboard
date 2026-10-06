/**
 * Release integrity checks (issue #41 / #122).
 *
 * Pure functions over injected file contents, shared by the `scripts/__tests__` suite (`pnpm test:scripts`),
 * the CLI below (`pnpm release:check`) and `.github/workflows/release.yml`.
 *
 *   pnpm release:check                              # consistency check of the working tree (runs in `pnpm test`)
 *   pnpm release:check --tag v1.0.0 --notes out.md  # release mode: tag == versions, dated heading, writes the notes
 *
 * Rules:
 *  - the four package.json versions (root, core, collector, dashboard) are identical `X.Y.Z`;
 *  - CHANGELOG.md has an `## [Unreleased]` section or the heading of that version (0.x);
 *  - from 1.0.0: a dated `## [X.Y.Z] - yyyy-mm-dd` heading exists, `[Unreleased]` holds no entries and
 *    docs/BLUEPRINT.md `Status` is `Stable`;
 *  - release mode additionally requires the tag `vX.Y.Z` to equal the version and the dated heading to exist.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const PACKAGE_FILES = [
  'package.json',
  'packages/core/package.json',
  'packages/collector/package.json',
  'packages/dashboard/package.json',
] as const;

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
/** The only tag shape the release workflow accepts: no pre-release or build suffix */
export const RELEASE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export interface ReleaseInputs {
  /** package.json path -> its `version` field (undefined when absent) */
  readonly versions: Readonly<Record<string, string | undefined>>;
  readonly changelog: string;
  readonly blueprint: string;
}

export interface CheckResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

export function isStableVersion(version: string): boolean {
  const m = SEMVER.exec(version);
  return m !== null && Number(m[1]) >= 1;
}

function isRealDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

interface Section {
  readonly heading: string;
  readonly body: string;
}

/** Splits a Keep a Changelog file into its `## ` sections (the preamble is dropped) */
export function splitSections(changelog: string): Section[] {
  const sections: Section[] = [];
  let current: { heading: string; lines: string[] } | undefined;
  for (const line of changelog.replace(/\r\n/g, '\n').split('\n')) {
    if (/^## /.test(line)) {
      if (current) sections.push({ heading: current.heading, body: current.lines.join('\n') });
      current = { heading: line, lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) sections.push({ heading: current.heading, body: current.lines.join('\n') });
  return sections;
}

/** Body lines that are neither blank nor a `###` sub-heading: the unreleased entries */
export function unreleasedEntries(changelog: string): string[] {
  const section = splitSections(changelog).find((s) => /^## \[Unreleased\]\s*$/i.test(s.heading));
  if (!section) return [];
  return section.body.split('\n').filter((l) => l.trim() !== '' && !/^###\s/.test(l));
}

export function hasUnreleasedSection(changelog: string): boolean {
  return splitSections(changelog).some((s) => /^## \[Unreleased\]\s*$/i.test(s.heading));
}

/** `{ heading, date }` of the `## [version] - date` line, or undefined */
export function findVersionHeading(
  changelog: string,
  version: string,
): { heading: string; date: string } | undefined {
  const prefix = `## [${version}] - `;
  const hit = splitSections(changelog).find((s) => s.heading.startsWith(prefix));
  return hit ? { heading: hit.heading, date: hit.heading.slice(prefix.length).trim() } : undefined;
}

/** The Markdown body of `## [version] - date`, trimmed, without trailing link reference definitions */
export function extractChangelogSection(changelog: string, version: string): string | undefined {
  const hit = splitSections(changelog).find((s) => s.heading.startsWith(`## [${version}] - `));
  if (!hit) return undefined;
  const lines = hit.body.split('\n');
  while (lines.length > 0 && /^(\s*|\[[^\]]+\]:\s.*)$/.test(lines[lines.length - 1] ?? '')) {
    lines.pop();
  }
  const notes = lines.join('\n').trim();
  return notes === '' ? undefined : notes;
}

export function blueprintStatus(blueprint: string): string | undefined {
  const m = /^>\s*\*\*Status:\*\*\s*(.+?)\s*$/m.exec(blueprint);
  return m?.[1];
}

/** The one version shared by all package.json files, or an error per problem found */
export function checkVersions(versions: ReleaseInputs['versions']): CheckResult & {
  version?: string;
} {
  const errors: string[] = [];
  for (const file of PACKAGE_FILES) {
    const v = versions[file];
    if (v === undefined) errors.push(`${file}: no "version" field`);
    else if (!SEMVER.test(v)) errors.push(`${file}: version "${v}" is not X.Y.Z`);
  }
  const distinct = new Set(PACKAGE_FILES.map((f) => versions[f]).filter((v) => v !== undefined));
  if (distinct.size > 1) {
    errors.push(
      `package.json versions differ: ${PACKAGE_FILES.map((f) => `${f}=${versions[f] ?? '-'}`).join(', ')}`,
    );
  }
  const version = errors.length === 0 ? versions[PACKAGE_FILES[0]] : undefined;
  return version === undefined ? { ok: false, errors } : { ok: true, errors, version };
}

function checkStable(input: ReleaseInputs, version: string): string[] {
  const errors: string[] = [];
  const heading = findVersionHeading(input.changelog, version);
  if (!heading) errors.push(`CHANGELOG.md: no "## [${version}] - yyyy-mm-dd" heading`);
  else if (!isRealDate(heading.date)) {
    errors.push(`CHANGELOG.md: heading of ${version} has no valid date ("${heading.date}")`);
  }
  const left = unreleasedEntries(input.changelog);
  if (left.length > 0) {
    errors.push(`CHANGELOG.md: [Unreleased] still holds ${left.length} line(s) of entries`);
  }
  const status = blueprintStatus(input.blueprint);
  if (status === undefined || !/^Stable(?![\w-])/.test(status)) {
    errors.push(`docs/BLUEPRINT.md: Status is "${status ?? 'missing'}", expected Stable`);
  }
  return errors;
}

function checkPreStable(input: ReleaseInputs, version: string): string[] {
  const ok =
    hasUnreleasedSection(input.changelog) ||
    findVersionHeading(input.changelog, version) !== undefined;
  return ok ? [] : [`CHANGELOG.md: neither an [Unreleased] section nor a heading for ${version}`];
}

/** Consistency check of the working tree; strict from 1.0.0 */
export function checkReleaseIntegrity(input: ReleaseInputs): CheckResult {
  const versions = checkVersions(input.versions);
  if (!versions.ok || versions.version === undefined) return versions;
  const errors = isStableVersion(versions.version)
    ? checkStable(input, versions.version)
    : checkPreStable(input, versions.version);
  return { ok: errors.length === 0, errors };
}

/** `vX.Y.Z` must equal the version of all four package.json files */
export function checkTagMatchesVersions(
  tag: string,
  versions: ReleaseInputs['versions'],
): CheckResult & { version?: string } {
  const m = RELEASE_TAG.exec(tag);
  if (!m) return { ok: false, errors: [`tag "${tag}" is not vX.Y.Z`] };
  const version = tag.slice(1);
  const errors = PACKAGE_FILES.filter((f) => versions[f] !== version).map(
    (f) => `${f}: version "${versions[f] ?? '-'}" does not match tag ${tag}`,
  );
  return errors.length === 0 ? { ok: true, errors, version } : { ok: false, errors };
}

/** Everything the release workflow needs: tag == versions, the integrity rules, and the release notes */
export function prepareRelease(
  tag: string,
  input: ReleaseInputs,
): CheckResult & { version?: string; notes?: string } {
  const tagCheck = checkTagMatchesVersions(tag, input.versions);
  if (!tagCheck.ok || tagCheck.version === undefined) return tagCheck;
  const errors = [...checkReleaseIntegrity(input).errors];
  const heading = findVersionHeading(input.changelog, tagCheck.version);
  if (!heading) {
    errors.push(`CHANGELOG.md: no "## [${tagCheck.version}] - yyyy-mm-dd" heading`);
  } else if (!isRealDate(heading.date) && !errors.some((e) => e.includes('valid date'))) {
    errors.push(`CHANGELOG.md: heading of ${tagCheck.version} has no valid date`);
  }
  const notes = extractChangelogSection(input.changelog, tagCheck.version);
  if (heading && notes === undefined) errors.push('CHANGELOG.md: the release section is empty');
  const unique = [...new Set(errors)];
  return unique.length === 0 && notes !== undefined
    ? { ok: true, errors: unique, version: tagCheck.version, notes }
    : { ok: false, errors: unique };
}

export function readInputs(root: string): ReleaseInputs {
  const versions: Record<string, string | undefined> = {};
  for (const file of PACKAGE_FILES) {
    const pkg = JSON.parse(readFileSync(path.join(root, file), 'utf8')) as { version?: string };
    versions[file] = pkg.version;
  }
  return {
    versions,
    changelog: readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'),
    blueprint: readFileSync(path.join(root, 'docs/BLUEPRINT.md'), 'utf8'),
  };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function fail(errors: readonly string[]): never {
  for (const e of errors) console.error(`[release-check] ❌ ${e}`);
  process.exit(1);
}

function main(): void {
  const input = readInputs(process.cwd());
  const tag = arg('--tag');
  if (tag === undefined) {
    const result = checkReleaseIntegrity(input);
    if (!result.ok) fail(result.errors);
    console.log('[release-check] ✅ release metadata is consistent');
    return;
  }
  const result = prepareRelease(tag, input);
  if (!result.ok || result.notes === undefined) fail(result.errors);
  const out = arg('--notes');
  if (out) writeFileSync(out, `${result.notes}\n`);
  console.log(`[release-check] ✅ ${tag} matches all package versions; release notes extracted`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
