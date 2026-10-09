# Walkthrough: Activity Query Deep Links, Rule-Match Filter, and Count-by-Day Chart (#83)

## Summary of Changes
Implemented the following features for the Activity page (`#/activity`) satisfying issue #83:
1. **URL Hash Query Synchronization**:
   - Implemented bidirectional synchronization with `#/activity?<params>` using `parseActivityQuery` and `formatActivityQuery`.
   - URL updates preserve page position unless a filter changes, which resets to page 1.
   - History entries are updated without stacking unnecessary history steps via `replaceQuery`.
2. **Rule-Match Filtering & Rule Badges**:
   - Added `ACTIVITY_RULES` mapping `AM-001` through `AM-007` to relevant activity item types.
   - Added rule filter (`all`, `any`, or specific rule ID like `AM-001`).
   - Timeline rows display matched rule badge tags (`AM-xxx`).
3. **Daily Activity Count Chart**:
   - Added `DailyActivityChart` component displaying counts per day in the selected month.
   - Includes accessible toggle to switch between bar chart visualization and data table.
4. **Documentation**:
   - Updated `docs/BLUEPRINT.md` and `docs/DASHBOARD-FEATURES.md` reflecting B2-13 enhancements.

## Verification Evidence
- `fork:verify`: All checks passed (fork-safe).
- `typecheck`: Passed for all packages (`core`, `collector`, `dashboard`).
- `test`: 41 test files passed, 455 tests passed in dashboard; all core tests passed.
- `secret-scan`: Clean (no secrets detected).
- `build`: Production build succeeded.
- `lint`: ESLint passed.
- `format:check`: Prettier passed.
