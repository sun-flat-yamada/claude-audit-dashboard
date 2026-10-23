# GitHub Pages Deployment Guide — Private & Internal Repositories

> **Important:** This project stores audit data and should be deployed from a **Private** or **Internal** repository.

## What gets published

`deploy-pages.yml` builds the dashboard with **the synthetic sample** (`data/sample/dashboard.json`) unless the repository variable **`PAGES_DATA_SOURCE=live`** is set. With `live`, it takes `data/dashboard.json` from the `data/audit` branch and also redeploys after every successful collection.

The published file contains aggregates only (KPIs, rule results, daily totals, top activity types, coverage). E-mail addresses are masked (`dashboard.maskPii`, default `true`), but organization names, rule evidence labels and cost figures are included — treat a live site as confidential.

### Per-person detail files (`PAGES_DETAIL_DATA`)

Member, API key, activity and organization / group views read separate **detail files** (`detail/index.json` manifest, `members.json`, `api-keys.json`, `activity-<yyyy-mm>.json`, `org-groups.json`, `config.json` (the effective configuration: rule states, thresholds, custom rules, notification channels by kind only; no secrets, URLs, addresses or paths), `archive.json` (the archive inventory: per-year snapshot counts, compressed sizes, oldest / newest snapshot ids; no file names or paths), `alerts.json` (the alert history: sent alerts with their acknowledgement; no webhook URLs, recipients or secrets), plus `monthly/index.json` and `monthly/<id>.json` for the monthly cost report and `compare/index.json` and `compare/<snapshot id>.json` for the time-point comparison (F-015: per judged snapshot the score, one status per rule and dataset and the KPI figures, the newest 90; statuses and counts only, no evidence or per-person data, but results and cost are confidential)), never `dashboard.json` (the optional model x RBAC group cost matrix, F-010, is part of `dashboard.json` as `modelMatrix`: aggregate-only, and the same group names and per-group cost are already published there as `usage.byGroup`). They contain per-person data: e-mail addresses and names are masked and user / key IDs are replaced by stable short hashes while `dashboard.maskPii` is `true`, but with `maskPii=false` they hold raw values. The monthly cost files hold no per-person data, but cost per RBAC group is confidential, so they are published under exactly the same condition (decision D2, conservative option). The comparison files are built from `summaries/<snapshot id>.json` on `data/audit`, which `pnpm check` writes next to every compliance report and which survives the archiving of the snapshot; `pnpm build:detail` backfills the summary of a stored snapshot that has none (older data, or a snapshot brought back with `pnpm restore`).

| `PAGES_DATA_SOURCE` | `PAGES_DETAIL_DATA` | Detail files on Pages                                     |
| ------------------- | ------------------- | --------------------------------------------------------- |
| unset (sample)      | any                 | the synthetic sample (`data/sample/detail/`)              |
| `live`              | unset / not `true`  | **none**; the detail pages show "not published" (default) |
| `live`              | `true`              | live files from `data/audit` (`data/detail/`)             |

`PAGES_DETAIL_DATA=true` is an explicit owner attestation: the workflow cannot detect Pages visibility, so set it **only for Private Pages (Option 1)**. Locally (`pnpm dev` after `pnpm build:data`) the files are always available.

### Acknowledging alerts (Alerts page)

The Alerts page (`#/alerts`) is read-only and shows the acknowledgement state of every alert sent by `pnpm notify`. A person with **write access to the repository** acknowledges an alert by its id (shown on the page):

- GitHub Actions: run the **Acknowledge Alert** workflow (`.github/workflows/ack-alert.yml`, Run workflow) with `alert-id` and an optional `by-label` (letters, digits, space, `.`, `_`, `-`; max 40; defaults to your GitHub user name). It restores `data/audit`, records the acknowledgement in `alerts/ack.json`, rebuilds `detail/alerts.json` and commits to `data/audit` only (never `main`); it needs no secrets and runs only from `main`.
- Locally, in a checkout that has the data (`.github/scripts/data-branch.sh restore`): `pnpm alerts ack <alert-id> [--by <label>]`, then `pnpm build:detail` and `.github/scripts/data-branch.sh save "<message>"`.

The label is free text: an e-mail address or URL is replaced by `[hidden]`. A second acknowledgement of the same alert keeps the first. The status shows on Pages after the next deployment (the Pages workflow stages `data/detail` from `data/audit`); `alerts/ack.json` itself is never published.

---

## Repository Visibility Requirements

| Visibility   | GitHub Pages Access                            | Recommended For                               |
| ------------ | ---------------------------------------------- | --------------------------------------------- |
| **Private**  | ⚠️ Pages are public by default (see below)     | Single-org use                                |
| **Internal** | Enterprise Cloud only, Pages can be restricted | Enterprise use                                |
| **Public**   | Pages are public                               | ❌ Not recommended (audit data exposure risk) |

---

## Option 1: GitHub Enterprise Cloud (Recommended)

**Best for:** Organizations with GitHub Enterprise Cloud plans.

GitHub Enterprise Cloud supports **private GitHub Pages** that are only accessible to users with repository read access.

### Setup Steps

1. **Repository Settings → Pages**
2. Set **Source** to **GitHub Actions**
3. Under **GitHub Pages visibility**, select **"Private"**
4. Only users with repository access can view the dashboard
5. Set the repository variable **`PAGES_DATA_SOURCE=live`** and re-run **Deploy Dashboard to GitHub Pages**
6. Optional: set **`PAGES_DETAIL_DATA=true`** to also publish the per-person detail files (members, API keys, activity, groups); leave it unset to keep them off Pages

### Characteristics

- ✅ Native GitHub Pages with access control
- ✅ No additional infrastructure needed
- ✅ SSO integration (if Enterprise Managed Users)
- ✅ Audit-safe — only authorized users can view
- ❌ Requires GitHub Enterprise Cloud license

---

## Option 2: Private Repo + Standard GitHub Pages (with Caveats)

**Best for:** GitHub Teams or Pro plans without Enterprise Cloud.

> ⚠️ **WARNING:** Even with a private repository, GitHub Pages sites are **publicly accessible by default** on `*.github.io`. The dashboard HTML/JS/CSS and the **embedded `dashboard.json`** will be publicly reachable.

### Mitigation: keep the default (sample data on Pages)

Leave `PAGES_DATA_SOURCE` **unset**. The public site then shows the synthetic tenant, while live data stays on the `data/audit` branch. This ensures:

- ✅ Dashboard UI is visible as a demo/showcase
- ✅ No real audit data exposed
- ❌ Live data not viewable in Pages (only in the repo itself)

### Accessing Live Data (Private Repo Owners)

```bash
.github/scripts/data-branch.sh restore   # copies data/ from the data/audit branch (gitignored locally)
pnpm build:core && pnpm build:data       # regenerates data/dashboard.json if needed
pnpm dev                                 # http://localhost:5173/claude-audit-dashboard/
```

The weekly and monthly reports (Markdown / HTML / CSV) are also on the `data/audit` branch under `data/reports/`.

---

## Option 3: Self-Hosted with Authentication

**Best for:** Organizations that need full control over access.

Instead of GitHub Pages, deploy the dashboard to a self-hosted platform with authentication. Build it with live data first:

```bash
.github/scripts/data-branch.sh restore
cp data/dashboard.json packages/dashboard/public/data/dashboard.json
VITE_BASE_PATH=/ STAGED_DATA=1 pnpm build:dashboard   # output: packages/dashboard/dist
```

### 3a. Vercel (Recommended)

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy from dashboard package
cd packages/dashboard
vercel deploy --prod
```

- Configure **Vercel Authentication** or **Deployment Protection**
- Supports SSO via Vercel Teams
- Zero config for Vite/React apps

### 3b. Netlify with Identity

```toml
# netlify.toml
[build]
  base = "packages/dashboard"
  command = "pnpm build"
  publish = "dist"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

- Enable **Netlify Identity** for authentication
- Supports role-based access

### 3c. Cloudflare Pages with Access

- Deploy to Cloudflare Pages
- Use **Cloudflare Access** to restrict to organization email domains
- Zero Trust access control

### 3d. Nginx with Basic Auth (Self-Hosted)

```nginx
server {
    listen 443 ssl;
    server_name audit.example.com;

    root /var/www/claude-audit-dashboard;
    index index.html;

    auth_basic "Audit Dashboard";
    auth_basic_user_file /etc/nginx/.htpasswd;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

---

## Option 4: GitHub Actions Artifact + Download

**Best for:** Maximum security, no web hosting.

Instead of hosting a live website, generate the dashboard as an artifact:

```yaml
# In deploy workflow
- name: Upload Dashboard as Artifact
  uses: actions/upload-artifact@v4 # use the current major version
  with:
    name: audit-dashboard-${{ github.run_number }}
    path: ./packages/dashboard/dist/
    retention-days: 90
```

Users download the artifact and open `index.html` locally:

- ✅ No public exposure whatsoever
- ✅ Works with any GitHub plan
- ❌ Less convenient (manual download required)

---

## Recommended Configuration by Scenario

| Scenario                   | Repository | Pages                            | Data             |
| -------------------------- | ---------- | -------------------------------- | ---------------- |
| Enterprise (full featured) | Internal   | Private Pages (Enterprise Cloud) | Orphan branch    |
| Team (secure)              | Private    | Demo-only Pages + Local dev      | Orphan branch    |
| Personal/Demo              | Private    | Sample data Pages                | Sample data only |
| Maximum security           | Private    | No Pages (artifact download)     | Orphan branch    |

---

## Protecting the data branches

Live audit data lives only on `data/audit` (and, from #154, the monthly ledger under `data/ledger/` on the same branch). Three settings keep it there.

### No saving from a public repository

`.github/scripts/data-branch.sh save` refuses to write when the repository is public: it prints `::error::Refusing to save live audit data: this repository is public` and exits non-zero, so the workflow run fails at the save step and nothing is pushed. Every workflow that writes the branch (`collect-audit.yml`, `weekly-report.yml`, `monthly-report.yml`, `ack-alert.yml`, `ledger-backfill.yml`, `ledger-seal.yml`, `ledger-verify.yml`) passes `REPOSITORY_VISIBILITY: ${{ github.event.repository.visibility }}` and `GH_TOKEN: ${{ github.token }}` to the save step. When the event payload carries no visibility (for example a `schedule` run), the script asks `gh api repos/<owner>/<repo>` and fails closed if it still cannot tell. `private` and `internal` save as before; a local run (outside GitHub Actions, variable unset) is unchanged.

If a run fails with this error, make the repository **Private** or **Internal** (Settings → General → Danger Zone → Change visibility) before running it again. Data already pushed to a public `data/audit` is exposed: rotate the credentials it could reveal and follow the rotation below to replace the branch history.

### Ruleset: no deletion or force push of `data/**`

A git branch can be deleted or rewritten, which would destroy or alter the audit trail. Protect it with a repository ruleset (Settings → Rules → Rulesets → New ruleset → New branch ruleset):

1. **Ruleset name**: `audit data`; **Enforcement status**: Active.
2. **Bypass list**: leave empty (add a maintainer role only if you perform the yearly rotation below; the workflows never need a bypass).
3. **Target branches**: Add target → Include by pattern → `data/**`.
4. **Branch rules**: enable **Restrict deletions** and **Block force pushes**. Do not enable _Require a pull request before merging_ or _Require status checks_: the workflows push commits directly with `GITHUB_TOKEN`.
5. Save. `data-branch.sh save` only adds commits (fast-forward), so collection keeps working.

The yearly rotation creates `data/audit-next` and renames branches; with this ruleset active, a maintainer in the bypass list performs it (or disables the ruleset for the duration).

### Fork of a fork: copy `main` only

A downstream fork holds its own `data/audit`. When anyone forks **that** fork, GitHub copies every branch unless _Copy the `main` branch only_ is checked, and the new fork then contains the live data. Always create a fork of a fork with **Copy the `main` branch only** checked. If a copy was made without it, delete the `data/*` branches in the new fork immediately (and treat the data as disclosed to whoever can read that fork). Upstream (`sun-flat-yamada/claude-audit-dashboard`) has no data branch, so forking upstream is safe either way.

---

## Long-Term Retention, Size Monitoring and Rotation of `data/audit`

`data/audit` is a git branch, so its size only ever grows: a snapshot that `pnpm archive` moves to `archive/<year>/<id>.json.gz` stays in the history as the blobs it had before, and the `.json.gz` file is added on top (gzip output does not deduplicate or delta against other archives). **Archiving shrinks the working tree, not the repository.** To bound the repository size you rotate the branch (below). The numbers behind the defaults are in [CHANGE-PLAN.md](CHANGE-PLAN.md) section 9.4; they are measured on a synthetic tenant and must be re-validated with your own data.

### Monthly ledger

Besides the snapshots, `data/audit` holds the monthly ledger `data/ledger/<yyyy-mm>/` (#154): one `<dataset>.jsonl.gz` per month without duplicates (events once per id, daily rows once per day and breakdown with the newest value, state datasets only when they change) and a `MANIFEST.json` with counts and SHA-256 hashes. `pnpm pipeline` updates it as its last step (a failure is a warning; the next run catches up). Run `pnpm ledger bootstrap` once after upgrading to build it from the existing `snapshots/` and `archive/` (re-running it is harmless). Months the collections never fetched (before the first run, or a stopped collection) are filled from the APIs with the manual **Ledger Backfill** workflow (`.github/workflows/ledger-backfill.yml`, input `from` = `yyyy-mm`) or `pnpm ledger backfill --from <yyyy-mm>` (#159): `usage_report` / `cost_report` serve only the last 365 days (2026-01 is gone after 2026-12-31), so run it early; the other Analytics datasets go back to 2026-01-01 and the Activity Feed to the day the Compliance API was enabled. The state datasets have no history and are not backfilled. A re-run continues where a run stopped (`ledger/BACKFILL.json`). The ledger is raw data (e-mail and IP addresses) and is never published to Pages. Rules and file format: [BLUEPRINT.md](BLUEPRINT.md) section 6.5.

#### Sealing and verification (#160)

With `ENABLE_SCHEDULED_JOBS=true` three schedules keep the ledger final and complete (all in the `audit-data` concurrency group):

- **Month end**: `collect-audit.yml` also runs at 23:30 UTC on the last day of the month (cron on the 28th-31st; `.github/scripts/month-end-guard.sh` skips the other days), so the month-end state and spend-limit values are recorded before month-to-date spend resets.
- **Seal** (`ledger-seal.yml`, the 10th at 04:00 UTC, previous month; manual input `month`; then copied to `ledger.sink` when set, see _Copies in external storage_): `pnpm ledger seal` re-fetches the month from the APIs and compares it with the ledger. A match writes `sealed: true`, the seal time and the re-fetched windows to `MANIFEST.json`; from then on the month's files never change. A difference (or a recorded dataset that cannot be re-fetched, e.g. a missing key) leaves the month unsealed, notifies, and fails the run. To reconcile: run **Ledger Backfill** with `from` = `to` = that month and `force` = `true` (it takes the API's values), then run **Ledger Seal** again for the month. A month that predates the API retention (usage / cost older than 365 days) cannot be sealed; list it in `compliance.params.OP-004.ignoreMonths`.
- **Verify** (`ledger-verify.yml`, daily at 05:30 UTC): `pnpm ledger verify` checks missing days of `usage` / `cost` in unsealed months, the age of the latest recorded collection and the hashes of every sealed month, and stores the result in `ledger/STATUS.json`. It notifies after 7 consecutive failing days (`ledger.verify.notifyAfterDays`) and when a sealed month received revisions. Fill a reported gap with **Ledger Backfill**; a hash mismatch in a sealed month means the file changed outside the tools: restore it from the `data/audit` history.

Entries that arrive for a sealed month later (a revised value, a late activity) are kept apart in `ledger/<yyyy-mm>/revisions/` and listed in `MANIFEST.json`; review them when notified. The dashboard shows the state as rules OP-003 (Ledger Verification) and OP-004 (Ledger Month Sealing).

#### Encryption at rest (#162, optional)

The ledger is raw data. To keep it unreadable for anyone who can read `data/audit` but not the repository secrets (a fork of a fork that copied every branch, a mirror or storage with the wrong permissions), encrypt it. It is **off by default**.

1. On your own machine (never on CI or in a Claude Code cloud session: both are refused), create one key pair per person or vault that must be able to read the ledger (**at least two**, see _Manual restore runbook_), and the workflows' key:

   ```bash
   pnpm ledger keygen --out ~/secure/ledger-owner.key        # prints the public key cadl-pub-...
   pnpm ledger keygen --pipeline --out ~/secure/pipeline.key  # the workflows' key
   ```

   Both refuse paths inside the data directory or the repository and never overwrite a file. Keep the private key files offline (password manager, hardware vault); they are never stored in GitHub.

2. Add the content of `pipeline.key` (the `CADL-PIPELINE-...` line) as the Actions secret **`LEDGER_PIPELINE_KEY`**, and keep `pipeline.key` offline as its backup (GitHub secrets are write-only: the value can never be read back from GitHub). Add the public keys to the repository variable `AUDIT_CONFIG_OVERRIDES`: `{"ledger":{"encryption":{"recipients":["cadl-pub-...","cadl-pub-..."]}}}`. The collection, backfill, seal and verify workflows pass the secret to the steps that read the ledger.
3. From the next run on, every written file is `<dataset>.jsonl.gz.enc` (AES-256-GCM, the file key wrapped for each public key and the pipeline key; details in [BLUEPRINT.md](BLUEPRINT.md) section 6.5). `MANIFEST.json` keeps the hash of the plaintext (`sha256`, used by seal and verify) and adds the hash of the stored bytes (`encryptedSha256`).
4. Encrypt the files written before: check out `data/audit` locally (`.github/scripts/data-branch.sh restore`), run `LEDGER_PIPELINE_KEY=... pnpm ledger encrypt` with the same `AUDIT_CONFIG_OVERRIDES`, and save it back (`.github/scripts/data-branch.sh save "chore: encrypt ledger"`). Sealed months stay sealed: their content and `sha256` do not change.
5. The earlier plaintext versions remain in the git history of `data/audit`. Remove them with the yearly rotation below (create the new orphan branch after step 4).

To read the ledger, decrypt it locally with a private key or the pipeline-key backup: `pnpm ledger decrypt --identity ~/secure/ledger-owner.key --out ~/ledger-plain [--month 2026-09]` (or `--pipeline-key ~/secure/pipeline.key`). It writes `<yyyy-mm>/<dataset>.jsonl` and `MANIFEST.json`, checks every file against `sha256`, and refuses to run on CI, in a Claude Code cloud session or to write into the data directory or the repository. Delete the output when done. The full procedure is the _Manual restore runbook_ below.

- **Adding or replacing a recipient**: update `recipients`, then `pnpm ledger encrypt --all` re-encrypts every file to the current list (also sealed months). A removed recipient can still read older copies in the git history.
- **Rotating or recovering the pipeline key**: see _Manual restore runbook_ (steps R2 and L1).
- **Recipients set without `LEDGER_PIPELINE_KEY`**: every ledger command stops before writing; `pnpm pipeline` only warns (the collection itself still succeeds). Snapshots under `data/snapshots/` are not encrypted.
- Losing every private key and the pipeline key makes the ledger unreadable.

### Copies in external storage

`data/audit` can be deleted or force-pushed, so set `ledger.sink` (#161, off by default) to also keep every sealed month where your organization controls the retention: SharePoint / OneDrive or a Google Drive shared drive (setup and retention labels / Vault rules: [SETUP.md](SETUP.md), _Copying sealed months to external storage_). **Ledger Seal** copies the month right after sealing it and verifies the copy in the step _Copy the sealed month to external storage_ (`pnpm ledger push --notify`); it authenticates with the workflow's OIDC token, so no cloud secret is stored. The copy holds the files exactly as stored (encrypted when the ledger is encrypted) in the ledger's layout (`<yyyy-mm>/<dataset>.jsonl.gz[.enc]`, `revisions/`, `MANIFEST.json`); a verified copy is listed in the local `MANIFEST.json` under `transfers`.

- **A failed copy** fails the step and notifies (`ledger-push:<month>:<kind>`); the seal itself and the save are not affected. Run **Ledger Seal** again with `month` set: the sealed month is re-verified and only missing or changed files are copied.
- **Months sealed before the sink was set**: run `pnpm ledger push --all` on a local checkout of `data/audit` with the same settings and save it back, or run **Ledger Seal** once per month. Locally only `filesystem` works without further setup (the cloud sinks need the workflow's OIDC token).
- **Restoring by hand**: copy a month folder from the storage into `data/ledger/<yyyy-mm>/` of a `data/audit` checkout, run `pnpm ledger verify`, and save it back; to read it without Actions follow the _Manual restore runbook_ below. Nothing in the copy is ever deleted by the tools; files that only the copy has are reported.
- **Re-encrypting a sealed month** (`pnpm ledger encrypt --all`) changes its stored bytes; the next push replaces those files (the storage keeps the previous versions where versioning is on).

### Manual restore runbook (#174)

The workflows read the encrypted ledger with the Actions secret `LEDGER_PIPELINE_KEY`. GitHub secrets are write-only, so the ledger must also be readable **without GitHub Actions**: from your own terminal, with a recipient private key or the offline backup of the pipeline key. Everything below runs on an operator's machine; the key and plaintext commands refuse to run on CI and in a Claude Code cloud session (`CLAUDE_CODE_REMOTE=true`), so that keys and decrypted data never land on a shared or agent-operated machine. Rehearse it once a year with one month.

Prerequisites: a clone of this repository (`main`) with `pnpm install --frozen-lockfile && pnpm build:collector`, and a working directory **outside** the clone for the data (here `~/restore`) and for the output (here `~/ledger-plain`). Without encryption, skip the key steps: the files are plain gzip JSON Lines (`gunzip -c <dataset>.jsonl.gz`).

#### K. Key custody

| Key                                      | Where it lives                                                                                                                                                        | Who can read the ledger with it                                                           |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Recipient identities (`CADL-SECRET-...`) | **Two or more**, each offline in a different place (two people's password managers, a hardware vault, a sealed offline copy). Never in GitHub, never in a repository. | Any one of them, alone, for every file encrypted while its public key was in `recipients` |
| Pipeline key (`CADL-PIPELINE-...`)       | The Actions secret `LEDGER_PIPELINE_KEY` (write-only) **and** the offline backup file `pipeline.key` from `keygen --pipeline`, kept like an identity                  | The workflows (secret) and you (backup file)                                              |
| Public keys (`cadl-pub-...`)             | `ledger.encryption.recipients` in `AUDIT_CONFIG_OVERRIDES`; not secret                                                                                                | Nobody (they only encrypt)                                                                |

- Keep a written list of the recipients' fingerprints and custodians outside GitHub; `pnpm ledger key-check --identity <file>` prints the fingerprint of the identity it used.
- After every key change run **Ledger Key Check** (manual run) and, locally, `pnpm ledger key-check --identity <file>` once per identity and `--pipeline-key ~/secure/pipeline.key`: each must pass.
- The **Ledger Key Check** workflow (`ledger-key-check.yml`, the 11th of each month with `ENABLE_SCHEDULED_JOBS=true`, and on demand) restores `data/audit` (read-only, never saved) and runs `pnpm ledger key-check` with the secret: it decodes every file in memory, compares it with `MANIFEST.json` and fails on any mismatch, logging only counts, fingerprints and file names. A failure means the secret no longer matches the ledger: use step L1 before anything else is written.

#### G. Get a month

1. **From `data/audit` (git)**:

   ```bash
   git clone --single-branch --branch data/audit --depth 1 <repository URL> ~/restore-src
   mkdir -p ~/restore/ledger && cp -R ~/restore-src/data/ledger/2026-09 ~/restore/ledger/
   ```

   A month that was later changed or deleted on the branch: clone without `--depth`, find the commit with `git log -- data/ledger/2026-09/MANIFEST.json` and copy it with `git archive <commit> data/ledger/2026-09 | tar -x -C ~/restore-src`.

2. **From external storage** (`ledger.sink`, #161): the copy has the ledger's layout (`<yyyy-mm>/<dataset>.jsonl.gz[.enc]`, `<yyyy-mm>/revisions/`, `<yyyy-mm>/MANIFEST.json`); put the month folder at `~/restore/ledger/<yyyy-mm>/` unchanged.
   - `sharepoint`: in the document library of `LEDGER_SHAREPOINT_DRIVE_ID`, open the folder `LEDGER_SHAREPOINT_FOLDER` (default `claude-audit-ledger`), select the `<yyyy-mm>` folder and **Download** (a zip), then extract it into `~/restore/ledger/`. With versioning, an earlier version of a file is under _Version history_.
   - `gdrive`: in the shared drive, open the folder `LEDGER_GDRIVE_FOLDER_ID`, right-click the `<yyyy-mm>` folder and **Download** (a zip), then extract it into `~/restore/ledger/`. A file Vault holds is exported through Google Vault.
   - `filesystem`: copy `<LEDGER_SINK_DIR>/<yyyy-mm>/`.

   Check that the zip did not rename anything (`revisions/` stays a sub-folder, file names keep `.jsonl.gz.enc`).

#### D. Check and decrypt

```bash
cd <clone of main>
export DATA_DIR=~/restore            # the folder that holds ledger/<yyyy-mm>/
pnpm ledger key-check --identity ~/secure/ledger-owner.key --month 2026-09    # or --pipeline-key ~/secure/pipeline.key
pnpm ledger decrypt  --identity ~/secure/ledger-owner.key --month 2026-09 --out ~/ledger-plain
```

- `key-check` writes nothing; it passes when the key opens every file and every file matches `MANIFEST.json` (`encryptedSha256` of the stored bytes, `sha256` of the content, nothing missing or unlisted). Without `--month` it checks every month under `~/restore/ledger/`.
- `decrypt` writes `~/ledger-plain/2026-09/<dataset>.jsonl`, `revisions/<dataset>.jsonl` and `MANIFEST.json` (mode 0600, never overwriting) and fails when a decrypted file differs from its `sha256`. It refuses an output directory inside the data directory or the clone.

#### V. Verify by hand (independent of the tool)

```bash
cd ~/restore/ledger/2026-09
sha256sum usage.jsonl.gz.enc                       # = datasets.usage.encryptedSha256 in MANIFEST.json
sha256sum ~/ledger-plain/2026-09/usage.jsonl        # = datasets.usage.sha256 (the decompressed JSON Lines)
wc -l ~/ledger-plain/2026-09/usage.jsonl            # = datasets.usage.count
```

Revision files are listed under `revisions.<dataset>` in the same way. A plain (`.jsonl.gz`) file: `gunzip -c usage.jsonl.gz | sha256sum` equals `sha256`. A sealed month (`sealed: true`) has the same hashes as when it was sealed. Delete `~/ledger-plain` when done.

#### R. Rotate keys

- **R1 Recipients** (a custodian leaves, a new vault): create the new identity (`pnpm ledger keygen --out ...`), update `recipients` in `AUDIT_CONFIG_OVERRIDES`, then on a local `data/audit` checkout (`.github/scripts/data-branch.sh restore`) run `LEDGER_PIPELINE_KEY="$(grep -v '^#' ~/secure/pipeline.key)" AUDIT_CONFIG_OVERRIDES='<same JSON>' pnpm ledger encrypt --all` and save it back (`.github/scripts/data-branch.sh save "chore: re-encrypt ledger"`). The removed identity can still read older copies in the git history and in external storage: rotate the branch (_Yearly rotation_) when that matters.
- **R2 Pipeline key**: `pnpm ledger keygen --pipeline --out ~/secure/pipeline-new.key`; then locally `LEDGER_PIPELINE_KEY="$(grep -v '^#' ~/secure/pipeline-new.key)" pnpm ledger encrypt --all --pipeline-key ~/secure/pipeline.key` (the old backup reads, the new key and the recipients wrap); save, replace the Actions secret with the new key, run **Ledger Key Check**, and only then retire the old backup. `--identity <file>` works in place of `--pipeline-key`.
- After R1 / R2 the next push of a sealed month replaces the stored files in external storage (where versioning keeps the previous ones).

#### L. Lost keys

- **L1 Pipeline key lost, or the secret no longer matches** (Ledger Key Check fails): if the backup file still exists, put it back as the secret. Otherwise generate a new pipeline key and run R2 with `--identity <file>` instead of `--pipeline-key` (a recipient identity reads every file). Until then the collection only warns about the ledger and seal / verify / backfill fail without writing.
- **L2 One identity lost**: the other identities and the pipeline key still read everything. Remove its public key and run R1 to re-encrypt without it; add a replacement so that two or more remain.
- **L3 Every identity lost, pipeline key known** (secret or backup): the ledger is still readable. Generate new identities, set them as `recipients` and run R1 (`encrypt --all` reads with the pipeline key).
- **L4 Every identity and the pipeline key (secret and backup) lost**: the encrypted files cannot be decrypted by anyone. Snapshots under `data/snapshots/` and `archive/` are not encrypted; move the unreadable `data/ledger/` aside (unreadable files are never overwritten), set new keys (K), then rebuild the months they cover with `pnpm ledger bootstrap` and the ones still within the API retention with **Ledger Backfill**. Older months are lost. This is why K asks for two or more identities and an offline pipeline-key backup.

### Measuring

```bash
pnpm size --repo . --ref data/audit      # totals, growth per 30 days, archive, blobs per dataset
pnpm size --repo . --ref data/audit --json
pnpm size --repo . --ref data/audit --notify --warn-only   # what the collect workflow runs
```

`--repo` is any clone that has the branch (fetch the full history first: `git fetch origin data/audit`; the collect workflow runs `restore` with `--depth=1`, so it fetches the history separately and does not measure the commit it is about to save). The result is judged against `capacity` in `config/default.json` (`0` turns a limit off):

| Key                            | Default | Meaning                                                                 |
| ------------------------------ | ------- | ----------------------------------------------------------------------- |
| `capacity.maxTotalMiB`         | `1024`  | Size of everything reachable from the branch                            |
| `capacity.maxMonthlyGrowthMiB` | `50`    | Growth projected to 30 days (the last `windowDays`, else the average)   |
| `capacity.warnRatio`           | `0.8`   | From `limit * ratio` up to the limit it is a warning, above it exceeded |
| `capacity.windowDays`          | `30`    | Window the growth is measured over                                      |

In the collect workflow the **Measure data/audit size** step sends one alert per cooldown (`notifications.cooldownMinutes`) through the configured channels when a limit is reached. It is never fatal: a failed measurement or notification is logged as a warning and the collection still succeeds.

### Restoring archived snapshots

```bash
pnpm restore 2024-05-01T06-00-00Z                    # one snapshot into the data directory
pnpm restore 2024 --out ./restored                   # a whole year into ./restored/snapshots/<id>/
DATA_DIR=./restored pnpm build:data --snapshot 2024-05-01T06-00-00Z    # dashboard.json for that snapshot
DATA_DIR=./restored pnpm build:detail --snapshot 2024-05-01T06-00-00Z  # detail files for it
```

To compare an archived snapshot (F-015) that has no stored summary (it is listed on `#/compare` as archived and disabled), in a checkout that has the data (`.github/scripts/data-branch.sh restore`):

```bash
pnpm restore 2024-05-01T06-00-00Z                      # same as pnpm cli restore <id>
pnpm build:detail --snapshot 2024-05-01T06-00-00Z      # writes data/summaries/<id>.json for that snapshot
pnpm build:detail                                      # the latest data again (restored points stay listed)
.github/scripts/data-branch.sh save "docs: summary of an archived snapshot"
```

An archived snapshot whose summary was stored is comparable without any of this. The summary rebuilt from the restored snapshot equals the one written when it was judged, so the diff does not depend on whether the snapshot was ever archived. Run the three build steps in a working copy that is not published in between, because `--snapshot` writes the detail files of that older snapshot.

Restored files are byte-identical to the originals (the collector's own writer is used); an existing snapshot is never overwritten and the archive is never modified. Restore into a separate `--out` directory to inspect old data: inside the live data directory the next `pnpm archive` would archive the restored snapshot again (to the same bytes). Without a stored compliance report the rules are evaluated in memory as of the snapshot's collection time.

### Yearly rotation of the orphan branch

When the size approaches the limit (or once a year, after the first `pnpm archive` of a year of data), start a fresh branch and move the old history out. Nothing is deleted before the old history is stored elsewhere and verified.

1. Pause the schedule (`ENABLE_SCHEDULED_JOBS` off) and wait for a running collection to finish (the `audit-data` concurrency group).
2. Keep the old history: `git fetch origin data/audit && git tag data-audit-2026 FETCH_HEAD && git push origin data-audit-2026`. A tag keeps every blob reachable in the same repository, so it does **not** reduce the repository size; to actually shed the size, also (or instead) store it outside:
   - a Release asset: `git bundle create data-audit-2026.bundle data/audit` (or `git archive`), attached to a private Release; or
   - external storage (an internal bucket or file share) with the same bundle, plus a note of where it is.
     Verify the copy: `git bundle verify` and `git clone data-audit-2026.bundle` followed by `pnpm size --repo <clone> --ref data/audit`.
3. Create the new orphan branch from the **latest state only** (the working tree of the old branch, so `state.json` cursors, reports and the newest snapshots carry over): in a clone, `git checkout --orphan data/audit-next`, remove everything except `data/`, commit, and push it. Archived years that you still want browsable can stay in `data/archive/`; their size is then part of the new history.
4. Replace the branch: rename the old branch (`data/audit` to `data/audit-2026-old`), push the new one as `data/audit`, and run the **Collect Audit Data** workflow once (a dry run first: `dry_run=true` runs everything without alerts or saving).
5. Delete the old branch only after the tag or bundle is verified and the first collection on the new branch succeeded. Deleting a branch and tag frees the space only after the server's garbage collection.

The Pages build and the dashboard read only the latest `dashboard.json` and detail files, so a rotation does not change what viewers see; the score trend restarts from the reports that were carried over.

### Verifying archiving on a fork (maintainers)

`collect-audit.yml` accepts two inputs on a manual run: `retention_days` (1-99999, archives snapshots older than that many days instead of `retention.snapshotDays`) and `dry_run` (no alerts, nothing saved). Both are passed through the environment and validated before use. A short `retention_days` (for example 1 to 7) on a verification fork exercises the archive, size and restore path in a few days; do not use a short value on the production branch, because the archive then fills the history with `.json.gz` blobs.

---

## Releasing (maintainers)

A release is a `vX.Y.Z` tag pushed by the repository owner; `.github/workflows/release.yml` does the rest. AI agents never push `main` or tags, so the owner prepares and tags.

1. **Prepare the release PR** (merged to `main` like any change): bump the `version` of the four `package.json` files (root, `packages/core`, `packages/collector`, `packages/dashboard`) to the same `X.Y.Z`; move the `[Unreleased]` entries of `CHANGELOG.md` under a dated `## [X.Y.Z] - yyyy-mm-dd` heading (this section becomes the release notes) and leave `[Unreleased]` empty; for 1.0.0 and later set the `docs/BLUEPRINT.md` Status to `Stable`. Run `pnpm verify:all` on the PR head; `pnpm release:check` (and the unit test in `pnpm test:scripts`) fails for 1.0.0 and later when a version differs, the dated heading is missing, `[Unreleased]` still holds entries or the Status is not `Stable`.
2. **Tag the merge commit on `main` and push the tag**: `git tag vX.Y.Z <commit> && git push origin vX.Y.Z`. Only the strict form `vX.Y.Z` is accepted (no pre-release or build suffix); the tagged commit must be on `main`.
3. **The workflow** checks out the tag, installs Chromium and runs `pnpm verify:all` (the same single command as locally: fork:verify, typecheck, test, secret-scan, build, lint, format:check, audit:deps, E2E and axe), checks that the tag equals the version of all four `package.json` files (`pnpm release:check --tag vX.Y.Z`), extracts the matching CHANGELOG section and **only then** creates the GitHub Release with it (`gh release create`, marked pre-release for `v0.*`). The `release` job is the only one with `contents: write`. If any step fails, no Release is created: fix the cause on `main`, delete the tag (`git push --delete origin vX.Y.Z`, `git tag -d vX.Y.Z`) and tag the new commit.
4. The tag is read from the environment, never interpolated into a script, and validated with a strict regular expression before use; runs of the same tag are serialized and not cancelled.

**v1.0.0 prerequisites (owner's checklist, not automated by this workflow):** Phase B (#46) and F-015 (#42) are closed, and the real-tenant records of #29 (B1: `pnpm pipeline` coverage, OP-002, `usage-matrix`) and #38 (B3: archive -> restore) are made on the release candidate commit. The release-candidate procedure and its record format (counts and statuses only) are tracked in #41 item 3.

<!-- TODO(#41 item 3): add the real-tenant release-candidate procedure and record format here. -->

---

## Environment Variables for Deployment

Regardless of hosting option, set these in your CI/CD:

```env
# Base path used by vite.config.ts (default: /claude-audit-dashboard/ for GitHub Pages)
VITE_BASE_PATH=/                          # custom domain / Vercel / Netlify

# Keep a pre-staged public/data/dashboard.json instead of copying data/ or data/sample/
STAGED_DATA=1
```

The dashboard itself shows whether it renders demo or live data (header badge, from the `source` field of `dashboard.json`).

---

## Fork Deployment Checklist

When setting up a fork for your organization:

- [ ] Set repository to **Private** or **Internal** (`data-branch.sh save` refuses to save from a public repository)
- [ ] Add the `data/**` ruleset (restrict deletions, block force pushes) — see [Protecting the data branches](#protecting-the-data-branches)
- [ ] When forking a downstream fork, check **Copy the `main` branch only**
- [ ] Configure secrets (`ANTHROPIC_ENTERPRISE_API_KEY`, notification channels) — see [SETUP.md](SETUP.md)
- [ ] Choose a deployment option above; set `PAGES_DATA_SOURCE=live` only for access-controlled Pages, and `PAGES_DETAIL_DATA=true` only for Private Pages (Option 1)
- [ ] Run the first collection: `workflow_dispatch` on "Collect Audit Data"
- [ ] Verify the `data/audit` orphan branch was created and contains `data/dashboard.json`
- [ ] Check the dashboard's Data coverage section (every dataset `Collected`)
- [ ] Set `ENABLE_SCHEDULED_JOBS=true`
- [ ] Trigger a weekly report manually to test the notification channels
