# GitHub Pages Deployment Guide — Private & Internal Repositories

> **Important:** This project stores audit data and should be deployed from a **Private** or **Internal** repository.

## What gets published

`deploy-pages.yml` builds the dashboard with **the synthetic sample** (`data/sample/dashboard.json`) unless the repository variable **`PAGES_DATA_SOURCE=live`** is set. With `live`, it takes `data/dashboard.json` from the `data/audit` branch and also redeploys after every successful collection.

The published file contains aggregates only (KPIs, rule results, daily totals, top activity types, coverage). E-mail addresses are masked (`dashboard.maskPii`, default `true`), but organization names, rule evidence labels and cost figures are included — treat a live site as confidential.

### Per-person detail files (`PAGES_DETAIL_DATA`)

Member, API key, activity and organization / group views read separate **detail files** (`detail/index.json` manifest, `members.json`, `api-keys.json`, `activity-<yyyy-mm>.json`, `org-groups.json`, `config.json` (the effective configuration: rule states, thresholds, custom rules, notification channels by kind only; no secrets, URLs, addresses or paths), plus `monthly/index.json` and `monthly/<id>.json` for the monthly cost report), never `dashboard.json`. They contain per-person data: e-mail addresses and names are masked and user / key IDs are replaced by stable short hashes while `dashboard.maskPii` is `true`, but with `maskPii=false` they hold raw values. The monthly cost files hold no per-person data, but cost per RBAC group is confidential, so they are published under exactly the same condition (decision D2, conservative option).

| `PAGES_DATA_SOURCE` | `PAGES_DETAIL_DATA` | Detail files on Pages                                     |
| ------------------- | ------------------- | --------------------------------------------------------- |
| unset (sample)      | any                 | the synthetic sample (`data/sample/detail/`)              |
| `live`              | unset / not `true`  | **none**; the detail pages show "not published" (default) |
| `live`              | `true`              | live files from `data/audit` (`data/detail/`)             |

`PAGES_DETAIL_DATA=true` is an explicit owner attestation: the workflow cannot detect Pages visibility, so set it **only for Private Pages (Option 1)**. Locally (`pnpm dev` after `pnpm build:data`) the files are always available.

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
