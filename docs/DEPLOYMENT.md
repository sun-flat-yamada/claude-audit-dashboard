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

## Long-Term Retention, Size Monitoring and Rotation of `data/audit`

`data/audit` is a git branch, so its size only ever grows: a snapshot that `pnpm archive` moves to `archive/<year>/<id>.json.gz` stays in the history as the blobs it had before, and the `.json.gz` file is added on top (gzip output does not deduplicate or delta against other archives). **Archiving shrinks the working tree, not the repository.** To bound the repository size you rotate the branch (below). The numbers behind the defaults are in [CHANGE-PLAN.md](CHANGE-PLAN.md) section 9.4; they are measured on a synthetic tenant and must be re-validated with your own data.

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

- [ ] Set repository to **Private** or **Internal**
- [ ] Configure secrets (`ANTHROPIC_ENTERPRISE_API_KEY`, notification channels) — see [SETUP.md](SETUP.md)
- [ ] Choose a deployment option above; set `PAGES_DATA_SOURCE=live` only for access-controlled Pages, and `PAGES_DETAIL_DATA=true` only for Private Pages (Option 1)
- [ ] Run the first collection: `workflow_dispatch` on "Collect Audit Data"
- [ ] Verify the `data/audit` orphan branch was created and contains `data/dashboard.json`
- [ ] Check the dashboard's Data coverage section (every dataset `Collected`)
- [ ] Set `ENABLE_SCHEDULED_JOBS=true`
- [ ] Trigger a weekly report manually to test the notification channels
