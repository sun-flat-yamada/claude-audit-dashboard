# Walkthrough: B2-9 F-011 theme toggle

## Summary

The primary navigation now has a Light / Dark / System switch. The choice is applied to `<html data-theme>` ("System" removes it so `prefers-color-scheme` applies) and stored in `localStorage` with every access guarded, so blocked storage renders the default theme and the switch still works for the session. No contract, collector or sample-data change.

## Changes Made

### packages/dashboard

- `src/lib/theme.ts` (new): preference parsing, guarded read/write, `resolveTheme` (stored > system > light), `applyTheme`.
- `src/components/ThemeToggle.tsx` (new): group "Theme" with Light / Dark / System buttons (`aria-pressed`, native keyboard support).
- `src/components/NavBar.tsx`, `src/App.tsx`: `actions` slot renders the toggle in the nav.
- `index.html`: guarded no-flash inline script.
- Tests: `lib/__tests__/theme.test.ts`, `components/__tests__/ThemeToggle.test.tsx` (incl. storage denied, persistence across remount, keyboard), toggle presence in `__tests__/app.test.tsx`.

### Docs

- `docs/DASHBOARD-FEATURES.md` F-011 row and section; `docs/BLUEPRINT.md` section 9.3.

## Verification Results

| Stage                    | Command                          | Result              |
| :----------------------- | :------------------------------- | :------------------ |
| Code-Data Decoupling     | `pnpm fork:verify`               | Clean (exit 0)      |
| TypeScript Check         | `pnpm typecheck`                 | Pass (exit 0)       |
| Unit & Integration Tests | `pnpm test`                      | 207/207 pass        |
| Zero Secret / PII Scan   | `pnpm secret-scan`               | 0 leaks (exit 0)    |
| Production Build         | `pnpm build`                     | Built               |
| Lint / Format / Audit    | `pnpm lint && pnpm format:check && pnpm audit:deps` | Clean |
