# Task List - Extension-point Gaps (#88)

- [ ] Core: Support `registeredDatasets` in `ConfigViewInput` and `sourcesOf` (`packages/core/src/application/presenters/config-view.ts`) <!-- id: 0 -->
- [ ] Collector: Pass `registeredDatasets` from collectors in `packages/collector/src/main/config-view.ts` <!-- id: 1 -->
- [ ] Key Family Registry: Introduce `KEY_FAMILIES` in `env.ts` and adapt `readEnvironment` / `container.ts` <!-- id: 2 -->
- [ ] Storage Sort: Extract extensible sort key registry in `repositories.ts` <!-- id: 3 -->
- [ ] Synthetic History: Replace exhaustive switch in `synthetic-history.ts` with dataset history rule registry <!-- id: 4 -->
- [ ] Classification & Config Hook: Verify `classify` export and `configPatch` container option <!-- id: 5 -->
- [ ] Documentation: Update `docs/ARCHITECTURE.md` §8.3 with single-registration recipe <!-- id: 6 -->
- [ ] Verification: Full quality gate passes cleanly and byte-identical test expectations <!-- id: 7 -->
