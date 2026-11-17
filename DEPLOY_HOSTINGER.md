# Deploying MeruVeda to Hostinger Node.js Hosting

Target topology (replaces the three-service Vercel deployment in `vercel.json`):

| App | URL | How |
|---|---|---|
| Frontend (Next.js 16) | https://meruvedawellness.com | `next start` on its own Node app |
| Backend (Express/TS) | https://api.meruvedawellness.com | `node dist/server.js` |
| Admin (Vite/React SPA) | https://api.meruvedawellness.com/admin | served by the backend as static files |

Two Hostinger Node.js applications are enough: **one for the repo (frontend)** and **one for the backend**. The admin is not a separate app — the backend serves `admin/dist/admin` at `/admin`. A third app or subdomain for the admin also works; see "Admin panel" below.

Prerequisites on Hostinger: Node.js 20+ available (`.nvmrc` pins the major), SSH or hPanel access, and DNS for both hosts pointing at the Node apps.

The repo is an npm-workspaces monorepo. Every build below runs from the repo root (`D:\mvv\meruveda_main-main` in this checkout; the Hostinger equivalent).

---

## 1. Backend (api.meruvedawellness.com)

**Root directory:** repository root (the backend is an npm workspace; do not point Hostinger at `backend/` alone — workspace deps like `@meruveda/shared` would not resolve).

**Build command:**
```
npm install && npm run build -w @meruveda/shared && npm run build -w backend
```
(`npm run build -w backend` runs `tsc` and `scripts/copy-assets.cjs`, which copies `backend/assets/` (invoice logo/fonts) and `expected-schema.json` into `backend/dist/`.)

**Start command:**
```
npm run start -w backend
```
which runs `node dist/server.js`. The server listens on `process.env.PORT` (assigned by Hostinger — never hardcode it) and binds `0.0.0.0`. `backend/package.json` already has `"start": "node dist/server.js"` and `"main": "dist/server.js"`.

**Env vars:** names only, in `backend/.env.example`. All are RUNTIME vars — set them in hPanel, not at build time. The server refuses to boot in production without: `JWT_SECRET`, `PAYU_MERCHANT_KEY`, `PAYU_SALT`, `ALLOWED_ORIGINS`, `CRON_SECRET`, and the R2 trio + pooled `DATABASE_URL`. Production must also have `NODE_ENV=production`.

Minimum for the storefront to work:
- `NODE_ENV=production`, `PORT` (leave to Hostinger), `TRUST_PROXY_HOPS=1`
- `DATABASE_URL` (pooled Neon, host contains `-pooler.`), `DATABASE_URL_UNPOOLED` (migrations), optionally `DATABASE_URL_APP`
- `JWT_SECRET`
- `ALLOWED_ORIGINS=https://meruvedawellness.com,https://www.meruvedawellness.com,https://api.meruvedawellness.com`
  (the browser origin of the admin SPA served by this backend is `https://api.meruvedawellness.com`; add `https://admin.meruvedawellness.com` if you split the admin out later)
- `FRONTEND_URL=https://meruvedawellness.com` (PayU redirects, password-reset links, ISR revalidation, invoice footer)
- `BACKEND_URL=https://api.meruvedawellness.com` (PayU surl/furl, Meta webhook callback helper)
- `REVALIDATE_SECRET` (shared with the frontend — any long random string)
- R2: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_MEDIA`, `R2_BUCKET_INVOICES`, `R2_PUBLIC_BASE_URL`
- PayU: `PAYU_MERCHANT_KEY`, `PAYU_SALT`, `PAYU_MODE=live`
- Email: `RESEND_API_KEY`, `EMAIL_FROM`
- Optional: `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (distributed rate limiting — without it limits are per-process)
- Shiprocket / WhatsApp as before (see `backend/.env.example`)

**Cookies:** the customer session cookie (`mv_customer_session`) is `HttpOnly; SameSite=Lax; Secure` (in production) and host-only. It works unchanged when the browser talks to the frontend origin and `/api/*` is proxied to the backend via the Next rewrite (recommended setup) — the cookie is first-party on `meruvedawellness.com`. Do NOT set a `Domain=` on it. The admin SPA authenticates with a Bearer token in `localStorage`, so it is unaffected by cookie domain rules regardless of where it is served from.

**Migrations:** run `npm run db:migrate -w backend` (uses `DATABASE_URL_UNPOOLED`) from a machine with access to Neon, or from the Hostinger SSH session.

---

## 2. Frontend (meruvedawellness.com)

**Root directory:** repository root (workspace app `meruveda`).

**Build command:**
```
npm install && npm run build -w @meruveda/shared && BACKEND_SERVICE_URL=https://api.meruvedawellness.com npm run build -w meruveda
```
**`BACKEND_SERVICE_URL=https://api.meruvedawellness.com` is REQUIRED at build time.** `next.config.ts` throws at build/startup without it when not on Vercel — the `/api/*` rewrite in `rewrites()` needs it. It is read only by the server at build/startup; it is never shipped to the browser.

**Start command:**
```
npm run start -w meruveda
```
(`next start`; binds the Hostinger-assigned `PORT`.)

**Env vars:** names only, in `frontend/.env.example`. Build-time: `BACKEND_SERVICE_URL`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_ADMIN_URL`, `NEXT_PUBLIC_OTP_ENABLED`, `NEXT_PUBLIC_ANALYTICS_ENABLED`, `NEXT_PUBLIC_GA_ID`, `NEXT_PUBLIC_META_PIXEL_ID`, `R2_PUBLIC_BASE_URL`. Runtime: `REVALIDATE_SECRET`.

Recommended production values:
- `BACKEND_SERVICE_URL=https://api.meruvedawellness.com`
- `NEXT_PUBLIC_API_URL=https://api.meruvedawellness.com/api`
  (used only for SSR fetches; browser traffic always goes same-origin `/api/*`)
- `NEXT_PUBLIC_ADMIN_URL=https://api.meruvedawellness.com/admin`
- `NEXT_PUBLIC_API_URL` must be `https` — an `http` value leaks into SSR and triggers insecure-content warnings.
- `REVALIDATE_SECRET` — same value as the backend's. The backend then POSTs to `https://meruvedawellness.com/api/revalidate` after admin writes.

**How /api works here:** browser → `https://meruvedawellness.com/api/...` → `next start` rewrites (in `next.config.ts`) → `https://api.meruvedawellness.com/api/...`. Images (`/api/images/fetch`) take the same path. No code changes are needed for Hostinger; `VERCEL` is simply unset, so the rewrite is active.

**Images:** `images.remotePatterns` allows `meruvedawellness.com`, `www.meruvedawellness.com`, `api.meruvedawellness.com`, plus the host derived from `R2_PUBLIC_BASE_URL` at build time (set it to the same value as the backend's). Remote product photos flow through `/api/images/fetch` (custom loader), so no extra hosts are needed.

---

## 3. Admin panel

On Vercel it was a separate static service rewritten to `/admin`. On Hostinger the simplest equivalent, already implemented, is: **the backend serves the built SPA at `/admin`**.

- `admin/vite.config.ts` builds with `base: '/admin/'` into `admin/dist/admin/`.
- `backend/src/app.ts` mounts `express.static` at `/admin` plus an SPA fallback (any GET under `/admin` that is not a file serves `index.html`), and skips mounting entirely with a warning when the build output is missing.
- Override the location with `ADMIN_DIST_DIR=/absolute/path/to/dist/admin` if the admin bundle lives elsewhere.

**Build the admin before (or as part of) the backend build:**
```
npm run build -w @meruveda/shared && npm run build -w meruveda-admin
```
The admin's own env vars are build-time (`VITE_*`): `VITE_API_BASE_URL=https://api.meruvedawellness.com/api`, `VITE_CUSTOMER_WEBSITE_URL=https://meruvedawellness.com`. Setting `VITE_AMINISTRATOR`-style URLs wrong only breaks links; API calls come from `VITE_API_BASE_URL`. Admin auth is a Bearer token in `localStorage` — no cookies involved, so no cross-origin cookie concerns.

Result: `https://api.meruvedawellness.com/admin/` serves the dashboard. `NEXT_PUBLIC_ADMIN_URL` on the frontend points there.

**Alternative (not implemented, use only if wanted):** a third Hostinger Node app serving `admin/dist` with `npx serve -s dist -l $PORT`, mounted on `admin.meruvedawellness.com`. Then set `VITE_API_BASE_URL` as above, add `https://admin.meruvedawellness.com` to backend `ALLOWED_ORIGINS` (admin origin becomes cross-origin), and set `NEXT_PUBLIC_ADMIN_URL=https://admin.meruvedawellness.com`. Functionally identical; more DNS and one more app to babysit.

**Security note:** the SPA fallback is intentionally generic — it never touches `/api/*`. The admin static mount does not list directories (`express.static` default), and `/admin` is outside the API's auth middleware, which is correct because admin auth happens client-side against `/api/*` with the Bearer token.

---

## 4. Scheduled jobs (replacing `vercel.json` crons)

`vercel.json` defined five cron jobs. None of them can run on Hostinger automatically. Replace them with **Hostinger cron jobs** (hPanel → Advanced → Cron Jobs) that curl the protected endpoints with the shared secret. Create the cron jobs on the BACKEND node app, or anywhere with network access.

Example crontab (times are UTC — adjust to your server timezone):

```cron
# Warm the backend (daily 01:00)
0 1 * * * curl -fsS https://api.meruvedawellness.com/api/warmup >/dev/null

# Retry due Shiprocket pushes + unsent invoices (daily 02:00)
0 2 * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" "https://api.meruvedawellness.com/api/jobs/sweep?limit=20" >/dev/null

# Shiprocket failure retry (daily 03:00)
0 3 * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" "https://api.meruvedawellness.com/api/orders/retry-shiprocket-failed?limit=20" >/dev/null

# Invoice/Shiprocket failure retry sweep (daily 03:30)
30 3 * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" "https://api.meruvedawellness.com/api/jobs/retry-failures?limit=15" >/dev/null

# 7-day review-request job (daily 10:00)
0 10 * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://api.meruvedawellness.com/api/jobs/review-requests >/dev/null
```

Store `CRON_SECRET` in the crontab environment or inline the literal in each line (hPanel does not expand variables in all setups — test one line manually first). Do **not** put the secret in the frontend or any `NEXT_PUBLIC_*` variable.

Alternatively, add `node-cron` inside the backend and schedule the same handlers in-process. That keeps everything in one place but runs in every instance (Hostinger Node is single-instance, so it would work) and adds a dependency — prefer the curl approach unless you need sub-minute precision, which the current daily jobs do not.

`/api/jobs/sweep`, `/api/jobs/retry-failures`, `/api/jobs/review-requests` and `/api/orders/retry-shiprocket-failed` all accept GET with `Authorization: Bearer $CRON_SECRET` (timing-safe compared; see `backend/src/routes/jobRoutes.ts`). `/api/warmup` needs no secret.

---

## 5. Third-party callback URLs to update after cutover

- **PayU** (dashboard): surl/furl are built at runtime from `BACKEND_URL` — set `BACKEND_URL=https://api.meruvedawellness.com`; no PayU-side config is needed for the callback target itself. If you registered a fixed return URL in the PayU dashboard, update it to `https://api.meruvedawellness.com/api/payu/callback`.
- **Shiprocket** (dashboard → Settings → Webhooks): point the webhook at `https://api.meruvedawellness.com/api/shiprocket/webhook` (same handler is also at `/api/logistics/webhook`). Keep the `x-api-key` token in sync with `SHIPROCKET_WEBHOOK_TOKEN`.
- **Meta WhatsApp** (App Dashboard → WhatsApp → Configuration): webhook callback = `https://api.meruvedawellness.com/api/whatsapp/webhook`, verify token = `WHATSAPP_WEBHOOK_VERIFY_TOKEN`. (The admin → Webhook info endpoint prints this same URL.)
- **Resend** (dashboard): verify `meruvedawellness.com` sending domain; `EMAIL_FROM` must use it.
- **NEON, R2, Upstash**: unchanged.

---

## 6. Deploy order

1. Backend: install, `npm run build -w @meruveda/shared && npm run build -w backend`, run migrations if pending, set env vars, start. Verify `https://api.meruvedawellness.com/api/health` → `{"status":"online"}`.
2. Admin build + it is served by the backend at `/admin` (rebuild backend not needed — the mount is resolved relative to the repo at process start; restart the backend if you build the admin after it).
3. Frontend: build with `BACKEND_SERVICE_URL=https://api.meruvedawellness.com`, start, verify `https://meruvedawellness.com`, `/products`, a product page, and `/api/images/fetch?url=…` all load.
4. Cutover DNS, then set up the five cron jobs, then remove Vercel env/crons.

---

## 7. Decommissioning Vercel

- `vercel.json` in the repo is now unused for hosting; delete it once the cutover is verified (kept for reference until then).
- `@vercel/analytics` and `@vercel/speed-insights` were removed from the frontend and admin (they 404 off-Vercel); GA4/Meta Pixel (env-gated) and the first-party beacon are untouched.
- `@vercel/functions` was removed from the backend; `keepAlive()` now simply holds the background promise (correct on a long-lived Node process).
- `RUNBOOK.md` / `SETUP.md` / `backend/.env.example` still contain historical Vercel instructions — they describe the old deployment and need a manual pass if you want them accurate.
