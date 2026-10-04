# Walkthrough: Raw response capture, sanitizer and fixture tenant

Refs #29 (Phase B1 foundation, items 1-5 of "テストを成立させる実装"). Real-tenant verification (V1/V2/V4/V5/V6) is not part of this change.

## Summary

A maintainer with a key can now capture real API responses (opt-in), sanitize them into synthetic, shape-only fixtures, and every key-free consumer (adapter tests, B2 screens, B5 E2E, Phase C regression) can run collect -> check -> dashboard on a tenant-shaped fixture tenant with a fixed clock.

## Changes Made

### Collector

- `adapters/anthropic/raw-capture.ts`: capture port and file sink (one file per request: path, query, status, body; no headers), loader, file naming without IDs, directory guard (outside the repo or gitignored `data/raw/`, refused when `CI=true`).
- `adapters/anthropic/http-client.ts`: optional `capture`; records the final response per request; scrubs the key if an API ever echoed it. Default behaviour unchanged.
- `main/cli.ts`, `main/container.ts`, `infrastructure/env.ts`: global `--capture-raw <dir>` flag and `CAPTURE_RAW_DIR`; announces that tenant data is being written.
- `adapters/anthropic/sanitizer.ts` and `main/sanitize.ts` (`pnpm sanitize`): e-mails -> `userN@example.com`; prefixed IDs / UUIDs -> deterministic synthetic IDs (prefix, length, character classes kept; one mapping across all files, injective); names -> `Synthetic <Kind> N`; IPs -> `192.0.2.0/24` (IPv6 `2001:db8::/32`); descriptions, user agents and key-like strings replaced; refuses to write when an original value would remain.
- `adapters/anthropic/replay-fetch.ts`: fake `fetch` serving captures (selectors: path, `after_id`, `page`, `group_by[]`, `statuses[]`; applies the Activity Feed time window like the server).
- `adapters/fixture/fixture-source.ts`, `main/fixture.ts` (`pnpm fixture:tenant --out <dir>`): runs the real clients, gateways, collectors, rules and dashboard on the fixtures with a fixed clock. Output is labelled `demo` (the published contract only allows `live | demo`).
- `adapters/anthropic/__tests__/fixtures/tenant/*.json`: 27 synthetic capture files (3 organizations, 14 members, paged members / activities / organizations / analytics users, 4 API keys with matching `api_actor` activity, unknown actor and activity types). Generated from invented data and passed through the sanitizer.

### Tests

- New: `raw-capture.test.ts` (key never stored, retries, off by default, directory guard), `sanitizer.test.ts` (mapping, consistency, no residue, official examples), `capture-sanitize.test.ts` (capture -> sanitize -> fixture tenant round trip), `fixture-tenant.test.ts` (determinism, valid dashboard, fixture hygiene).
- `gateways.test.ts` and `collectors.test.ts` now run a shared suite on both the official-example and the tenant-shape fixtures (`src/__tests__/fixture-sets.ts`).

### Checks and docs

- `scripts/fork-verify.ts`: new check 3b (tenant fixtures: example.com e-mails only, `192.0.2.0/24` IPs only, no key patterns, directory present); `data/raw` forbidden on the code branch and required in `.gitignore`.
- `scripts/secret-scan.ts`: the tenant fixture directory is scanned explicitly and its absence fails the scan.
- `docs/SETUP.md`, `CONTRIBUTING.md`, `.env.example`: capture + sanitize procedure. `docs/CHANGE-PLAN.md` section 10 V6: the header is fixed in `http-client.ts` `request()`; changing it needs a code change.

## Verification Results

| Stage                    | Command                          | Result                                         |
| :----------------------- | :------------------------------- | :--------------------------------------------- |
| Code-Data Decoupling     | `pnpm fork:verify`               | Clean (exit 0)                                 |
| TypeScript Check         | `pnpm typecheck`                 | Pass (exit 0)                                  |
| Unit & Integration Tests | `pnpm test`                      | core 55/55, dashboard 8/8, collector 98/98, scripts 23/23 |
| Zero Secret / PII Scan   | `pnpm secret-scan`               | 0 leaks (exit 0)                               |
| Production Build         | `pnpm build`                     | Built                                          |
| Lint / Format (CI)       | `pnpm lint && pnpm format:check` | Clean                                          |
| Dependency audit (CI)    | `pnpm audit:deps`                | No known vulnerabilities                       |

## Left for the human verification (#29)

Run the capture against the real tenant, sanitize, review, add the tenant-derived fixtures, and record V1/V2/V4/V5/V6. Nothing in this change was verified against a real tenant; the tenant-shape fixtures are invented shapes based on the gateway schemas.
