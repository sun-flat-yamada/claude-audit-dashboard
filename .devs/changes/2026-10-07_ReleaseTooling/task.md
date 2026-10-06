# Task: release tooling (#122, refs #41)

- [x] Issue #122 (sub-issue of #41), branch `chore/122-add-verify-all-release-integrity-test`
- [x] Plan and task committed on their own
- [ ] `scripts/verify-all.ts` + test
- [ ] `scripts/release-integrity.ts` + tests (0.x passes, bad fixtures fail)
- [ ] `.github/workflows/release.yml` + guard tests
- [ ] Docs sync (AGENTS, quality-rules-gate, CLAUDE, BLUEPRINT 18.2, CONTRIBUTING, DEPLOYMENT, CHANGELOG)
- [ ] Quality gate and one full `pnpm verify:all` run
- [ ] Walkthrough, push, draft PR (Auto-Pilot off)
- [ ] Rebase merge (owner)
