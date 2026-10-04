# B2-9 F-011 Theme toggle (light / dark / system)

Closes #51. Refs #37 (tracking). Plan source: `.devs/changes/2026-10-04_DashboardDetailPagesPlan/implementation_plan.md` section B2-9 (owner accepted D1-D8; this unit has no open decision). Prerequisite B2-0 (#49, PR #50) is merged.

## User Review Required

> [!IMPORTANT]
> No contract, collector or demo change. `data/sample/` is untouched.

> [!WARNING]
> The persisted preference is the only new browser state. It lives in `localStorage` under one key and every access is wrapped in try/catch: a blocked or throwing storage must render the default theme (follow `prefers-color-scheme`) and still toggle for the session.

## Proposed Changes

### packages/dashboard

#### [NEW] `src/lib/theme.ts`

- Pure helpers: `ThemePreference = 'light' | 'dark' | 'system'`, `parsePreference`, `readStoredPreference()` / `storePreference()` (try/catch), `applyTheme(pref, root)` (`light`/`dark` set `data-theme`; `system` removes it so the `prefers-color-scheme` media query applies), `resolveTheme(stored, systemPrefersDark)` (order: stored > system > default light).

#### [NEW] `src/components/ThemeToggle.tsx`

- A `role="group"` named "Theme" with three buttons (Light, Dark, System) using `aria-pressed`; native buttons, so Tab / Enter / Space work. State initialised from storage, applied to `<html>` on change, persisted best-effort.

#### [MODIFY] `src/App.tsx`, `src/components/NavBar.tsx`

- Render the toggle in the primary navigation (right end), keeping the nav usable at 390 px.

#### [MODIFY] `index.html`

- Guarded no-flash inline script: reads the stored preference in try/catch and sets `data-theme` before first paint.

#### [MODIFY] `src/index.css`

- Only if tokens are missing (none expected).

### Tests

- `src/lib/__tests__/theme.test.ts`: parse, resolve order, apply, storage throwing on read and write.
- `src/components/__tests__/ThemeToggle.test.tsx`: roles and names, aria-pressed, keyboard activation, persistence across remount, storage-denied still toggles for the session, nothing stored leaves `data-theme` unset.

### Docs

- `docs/DASHBOARD-FEATURES.md` F-011 matrix row and section; `docs/BLUEPRINT.md` section 9 (display requirements).

## Verification Plan

### Automated Tests

- `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build`
- `pnpm lint && pnpm format:check && pnpm audit:deps`
- Targeted: `pnpm --filter @claude-audit/dashboard test`

### Manual Verification

- Inspect the built bundle for the inline script; toggle in a browser with storage disabled if available.
