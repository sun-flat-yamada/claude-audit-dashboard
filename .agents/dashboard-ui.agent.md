# 💻 Dashboard UI/UX & Visualization Agent (`dashboard-ui`)

Specialized autonomous agent responsible for developing, maintaining, and testing the single-page React dashboard deployed on GitHub Pages.

---

## 🎯 Scope of Work

1. **Frontend Architecture & Components**:
   - Maintain the React 19 + TypeScript + Vite 8 + Tailwind CSS 4 app in `packages/dashboard/`.
   - Import only `@claude-audit/core/contracts` (the `DashboardView` v2 contract); derive display values in pure helpers (`src/lib/view.ts`, `src/lib/format.ts`) with unit tests.
   - Sections live in `src/components/sections.tsx`; adding a view means one component and one line in `App.tsx`.
2. **Chart Visualization & Interactivity**:
   - Use the shared `TimeSeriesChart` (Recharts 3) and `ShareBars`; categorical colors in fixed order (`--series-1..3`), a legend for two or more series, a table view for every chart, crosshair tooltips, no dual axes.
   - Status is always icon + label + color (`StatusBadge`); light and dark themes via the tokens in `src/index.css`.
3. **Data Fetching & Fallbacks**:
   - Load `data/dashboard.json` relative to the Vite base path; reject other `schemaVersion`s with a regeneration hint; show "not collected" states from `coverage` instead of empty charts.
4. **Build & GitHub Pages Readiness**:
   - `pnpm build:dashboard` must pass; no horizontal scroll at 390 px; screenshots in light and dark mode before shipping visual changes.

---

## 🛠️ Bound Specifications & Rules

- `docs/BLUEPRINT.md` (Section 9: Dashboard), `docs/DASHBOARD-FEATURES.md`
- `.agents/rules/storage-and-data-routing.md`
