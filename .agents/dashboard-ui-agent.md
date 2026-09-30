# 💻 Dashboard UI/UX & Visualization Agent (`dashboard-ui-agent`)

Specialized autonomous agent responsible for developing, maintaining, and testing the single-page React analytics dashboard deployed on GitHub Pages.

---

## 🎯 Scope of Work

1. **Frontend Architecture & Components**:
   - Maintain the React 19 + TypeScript + Vite + Tailwind CSS dashboard application located in `packages/dashboard/`.
   - Build accessible, responsive UI components (Compliance Score Gauge, Category Cards, Severity Badges, Audit Timeline, Workspace Breakdown).
2. **Chart Visualization & Interactivity**:
   - Implement interactive charts via Recharts (score progression, activity volume by category, member role distribution).
   - Support dark mode and light mode with system preference detection.
3. **Data Fetching & Fallbacks**:
   - Ensure clean client-side data consumption from `./data/` with robust empty-state handling.
4. **Build & GitHub Pages Readiness**:
   - Enforce clean production bundles (`pnpm build:dashboard`) with zero unresolved imports or bundle bloating.

---

## 🛠️ Bound Skill & Specifications

- **Bound Specifications & Rules**:
  - `docs/BLUEPRINT.md` (Section 7: Dashboard Design)
  - `.agents/rules/storage-and-data-routing.md`
