# GitHub Pages Deployment Guide — Private & Internal Repositories

> **Important:** This project stores audit data and should be deployed from a **Private** or **Internal** repository.

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

### Mitigation: Use Sample Data in Pages Build

Configure the dashboard to use **sample/demo data** for the public Pages site, while keeping live audit data in the orphan branch (not deployed):

```yaml
# .github/workflows/deploy-pages.yml
- name: Stage DEMO data only for Pages
  run: |
    cp data/sample/dashboard.json packages/dashboard/public/data/dashboard.json
    echo '{"source":"demo","built_at":"..."}' > packages/dashboard/public/data/meta.json
```

This ensures:

- ✅ Dashboard UI is visible as a demo/showcase
- ✅ No real audit data exposed
- ❌ Live data not viewable in Pages (only in the repo itself)

### Accessing Live Data (Private Repo Owners)

- Clone the repo and run `pnpm dev` locally with real data from the orphan branch
- Or access via GitHub's file browser on the `data/audit` branch

---

## Option 3: Self-Hosted with Authentication

**Best for:** Organizations that need full control over access.

Instead of GitHub Pages, deploy the dashboard to a self-hosted platform with authentication:

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
  uses: actions/upload-artifact@v4
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
# vite.config.ts base path — adjust per hosting
VITE_BASE_URL=/claude-audit-dashboard/   # For GitHub Pages
VITE_BASE_URL=/                          # For custom domain / Vercel / Netlify

# Data source indicator
VITE_DATA_SOURCE=live                    # or 'sample' for demo mode
```

---

## Fork Deployment Checklist

When setting up a fork for your organization:

- [ ] Set repository to **Private** or **Internal**
- [ ] Configure GitHub Secrets (API keys, notification webhooks)
- [ ] Choose deployment option from above
- [ ] Run first collection: `workflow_dispatch` on "Collect Audit Data"
- [ ] Verify `data/audit` orphan branch was created
- [ ] Verify dashboard loads with data
- [ ] Configure notification channels
- [ ] Test alert notifications
