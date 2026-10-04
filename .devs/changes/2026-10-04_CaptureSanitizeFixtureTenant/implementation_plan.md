# Raw response capture, sanitizer and fixture tenant (Phase B1 foundation)

Refs #29 (Phase B1, parent #46). Implements only the key-free "テストを成立させる実装" items 1-5.
Real-tenant verification (V1/V2/V4/V5/V6) is a human task and is out of scope; this PR therefore
uses `Refs #29`, not `Closes #29`.

## User Review Required

> [!IMPORTANT]
> Scope is limited to items 1-5 of the issue. No behaviour of the default (non-capture) collection path changes.

> [!WARNING]
> - The `fixture` source labels its output `source: "demo"` because the published dashboard contract (`DashboardView` v2) only allows `live | demo`. Widening the contract is deliberately not done here.
> - Raw capture output may contain real tenant data. It is opt-in, refused when `CI=true`, and only allowed outside the repository or under the gitignored `data/raw/`.
> - Hosted session note: the branch assigned by the platform is kept (no rename), per the task instructions.

## Proposed Changes

### Collector: raw capture (item 1)

#### [NEW] `packages/collector/src/adapters/anthropic/raw-capture.ts`

- `RawCapture` port, `RawCaptureEntry` (request path + query, response status + body; never headers or keys), `FileRawCapture` (one file per request), `loadCaptureEntries`, `resolveCaptureDir` (location and CI guard).

#### [MODIFY] `packages/collector/src/adapters/anthropic/http-client.ts`

- Optional `capture` option; records the final response of each request (success or failure). Default path unchanged.

#### [MODIFY] `packages/collector/src/main/{cli,commands,container}.ts`, `infrastructure/env.ts`

- Global `--capture-raw <dir>` flag (and `CAPTURE_RAW_DIR`), wired to every `HttpClient`. Default off.

### Collector: sanitizer (item 2)

#### [NEW] `packages/collector/src/adapters/anthropic/sanitizer.ts`

- Pure `Sanitizer`: e-mail -> `userN@example.com`, prefixed IDs / UUIDs -> deterministic synthetic IDs (prefix, length and character classes preserved, one mapping for all files), names -> synthetic names, IPs -> `192.0.2.0/24` (IPv6 -> `2001:db8::/32`), free text and user agents blanked, key-like strings redacted, residual check on the output.

#### [NEW] `packages/collector/src/main/sanitize.ts` + `sanitize` command

- `pnpm sanitize <in-dir> <out-dir>`: sorted, shared mapping, refuses to write output that still contains an original value.

### Collector: fixtures, replay and `fixture` source (items 3-5)

#### [NEW] `packages/collector/src/adapters/anthropic/__tests__/fixtures/tenant/*.json`

- Synthetic, shape-only tenant responses in the capture format (several orgs, members, groups, API keys whose IDs match `api_actor` activity, paged activities, per-dimension usage/cost).

#### [NEW] `packages/collector/src/adapters/anthropic/replay-fetch.ts`

- `fetch` that serves capture entries (selector keys: path, `after_id`, `page`, `group_by[]`).

#### [NEW] `packages/collector/src/adapters/fixture/fixture-source.ts`, `main/fixture.ts`, `fixture` command

- Collectors fed by the replay fetch with a fixed clock; `collect -> check -> dashboard` writes `dashboard.json` and `compliance-report.json`. Same role as `adapters/demo/demo-source.ts`.

#### [MODIFY] `gateways.test.ts`, `collectors.test.ts` (+ new tests)

- A shared suite runs against both the official-example fixtures and the tenant-shape fixtures.

#### [MODIFY] `scripts/fork-verify.ts`, `scripts/secret-scan.ts`, `.gitignore`

- fork:verify checks the tenant fixture directory explicitly (example.* e-mails only, no key patterns, exists); secret-scan asserts the directory is in scope; `data/raw/` is gitignored and forbidden on the code branch.

### Docs

#### [MODIFY] `docs/SETUP.md`, `CONTRIBUTING.md`, `docs/CHANGE-PLAN.md`

- Capture + sanitize procedure; CHANGE-PLAN section 10 V6 mitigation: header fixed in `http-client.ts` `request()`, changing it needs a code change.

## Verification Plan

### Automated Tests

- `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`
- `pnpm lint && pnpm format:check`
- Targeted: raw-capture (fake fetch, key absent), sanitizer (no residual originals, consistent mapping), gateways/collectors on both fixture sets, fixture tenant pipeline (deterministic dashboard.json).

### Manual Verification

- `pnpm sanitize` over a scratch capture; `pnpm --filter @claude-audit/collector cli fixture --out <scratch>`.
