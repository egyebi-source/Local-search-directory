# PRD — TorqueRank (Local Search Growth Dashboard)

Version 1.0 · Owner: Emmanuel · Stack: Next.js on Vercel + Neon Postgres

---

## 1. Summary

A web app for small business owners (body shops, trades, local manufacturers) that answers one question: **"Is my online presence actually producing clicks, visits and leads, and what should I fix this week?"**

It combines three data sources into one dashboard:

| Source | What it gives us | Who it belongs to |
|---|---|---|
| DataForSEO | Competitor paid-search keywords, estimated cost-per-click, ad copy | Our API account |
| Google Search Console (GSC) | The user's organic queries, impressions, clicks, average position | The user's Google account |
| Google Analytics 4 (GA4) | The user's sessions, traffic sources, key events (calls, form submits) | The user's Google account |

Gemini turns the combined data into a short, prioritized action checklist with ready-to-use copy.

## 2. Users and access levels

1. **Visitor (not signed in).** Enters a website URL on the home page and gets a **Competitor Snapshot** (assessment) with no sign-up. Part of the result is shown; the rest is locked. No Google connection. Rate-limited.
2. **Trial member.** Unlocks the full dashboard by passing the **gate**: email sign-in (magic link or Google basic profile) plus four short questions. This starts a **7-day free trial, no card required**. During the trial they can connect Google Search Console and GA4 through Google's consent screen.
3. **Paying member.** Adds a card for a monthly or annual subscription (Stripe) at any time; the dashboard stays unlocked.
4. **Org owner.** Manages the organization, invites teammates (e.g., their web agency), connects/disconnects Google, deletes data.
5. **Platform admin (us).** Views system health and sync failures. **Cannot view customer Google data** except aggregate counts.

### 2.1 Visitor journey (assessment first, sign-in later)

1. **Assess.** Home page asks for the website URL (plus service area and business type, pre-filled where possible). The assessment runs immediately — no account.
2. **Tease.** Results page shows a few headline insights in full; the remaining insights and the dashboard preview are locked. **Locked content is never sent to the browser** (no CSS blur over real data): the server renders placeholders until the account is unlocked.
3. **Gate.** "Unlock your full dashboard" → email sign-in → four questions:
   - Business type & service area (pre-filled from the assessment)
   - Main goal: more phone calls / more form leads / more walk-ins / spend less on ads
   - Current monthly Google Ads spend: none / under $500 / $500–2,000 / $2,000–5,000 / over $5,000
   - Who manages the website: me / an agency or freelancer / nobody right now
   Completing the gate creates the organization, attaches the assessment to it, and **starts the 7-day trial**.
4. **Complete the picture.** Inside the dashboard, prompts to connect Search Console and GA4 (via Google's consent screen — see below) so organic data is combined with the paid competitor data. If an agency manages the site (gate answer), suggest inviting them.
5. **Convert or lock.** Trial banner counts down. On day 8 an unpaid dashboard **locks** (data kept, nothing shown) with "Add a card to unlock". 30 days after locking, Google access is revoked and all org data is deleted (Module 10).

### 2.2 How a member adds their own Google data

- The visitor clicks **"Connect your Google data"** → is asked to create a free account (email magic link or Sign in with Google, basic profile only) → lands on the Connect screen → clicks **"Connect Google Search Console & Analytics"** → Google's own consent screen shows exactly which read-only permissions we request → user approves → user picks which Search Console site and which GA4 property to link.
- The user never types a Google password, API key, or credential file into our app. The UI must say this plainly: *"You'll approve access on Google's own page. We never see your password, and access is read-only."*
- If the person who controls GA4/GSC is someone else (an agency or web developer), the owner can **invite them** to the org and they connect with their Google account.
- If the business has no GSC or GA4 yet, show a guided "Set up Search Console / GA4" help page and keep the Competitor Snapshot working without it.

## 3. Goals and non-goals

**Goals (v1):** assessment-first funnel (value before sign-up); 7-day no-card trial with paid monthly/annual plans; secure optional Google connection; daily cached dashboard; keyword-gap "Rescue Targets"; AI action checklist; full self-service disconnect and deletion.

**Non-goals (v1):** managing or editing Google Ads campaigns; writing to GSC/GA4 (read-only only); publishing content to the user's website automatically; white-label agency mode; mobile app.

## 4. Stack and infrastructure

- **Next.js** (App Router, TypeScript strict) on **Vercel**. Pro plan recommended (cron frequency and function duration).
- **Neon Postgres** via the Vercel Marketplace integration. Production uses the main branch; each Vercel preview deployment gets its own Neon branch with **no production customer data** (seed data only).
- **Drizzle ORM** with migrations checked into git.
- **Auth.js v5** for login (email magic link via Resend + Google sign-in with `openid email profile` scopes only).
- **Upstash Redis** (via Vercel Marketplace) for rate limiting and short-lived locks.
- **Cloudflare Turnstile** for bot protection on the public snapshot form.
- **Resend** for transactional email.
- **Sentry** for error monitoring (with token/PII scrubbing).
- **Vercel Cron** for scheduled syncs and trial lock/deletion jobs.
- **Stripe** (Checkout + Customer Portal + webhooks) for subscriptions. We never see or store card numbers.

## 5. Functional requirements

### Module 1 — Public Competitor Snapshot / assessment (visitors, the front door)
- FR-1.0 The home page **is** the assessment form. Sign-in is not required to run it; a small "Sign in" link serves returning users.
- FR-1.1 Form: website URL, service area (city/region), business category. Validate and normalize the domain.
- FR-1.2 Protected by Turnstile + rate limit (e.g., 3 snapshots per IP per day, 50 per day globally on the free tier; values configurable).
- FR-1.3 Server calls DataForSEO for competitor paid keywords in that area; results cached per `domain + location` for 7 days to control cost.
- FR-1.4 Gemini produces a 5-item summary. Shareable result page at an unguessable URL (random 22+ char ID), expires after 30 days.
- FR-1.5 Results page shows a limited set of insights; the rest is locked behind the gate (§2.1). Locked items are rendered as server-side placeholders; their content is not in the HTML, JSON or RSC payload. CTA: "Unlock your full dashboard — free for 7 days, no card."
- FR-1.7 On gate completion the snapshot is attached to the new organization (copied into org-scoped tables) so the dashboard opens with it already populated.
- FR-1.6 Daily DataForSEO and Gemini spend caps; when hit, show a friendly "try again tomorrow" message and alert the admin.

### Module 2 — Accounts, organizations and the gate
- FR-2.1 Sign up/in with email magic link or Google (profile scopes only). Sign-in is reached from the gate (with the snapshot id carried through) or the "Sign in" link.
- FR-2.2 Every user belongs to at least one organization. Roles: `owner`, `member`. A new organization is created by completing the gate questions (§2.1 step 3), all validated with Zod.
- FR-2.3 Owners can invite by email (expiring, single-use invite tokens stored hashed).

### Module 3 — Google data connection (OAuth)
- FR-3.1 Separate from login. Uses its own OAuth flow with `access_type=offline`, `include_granted_scopes=true`, `prompt=consent`, a `state` parameter, and PKCE.
- FR-3.2 Scopes: exactly those in §6.3. The consent request asks for GSC and GA4 together, but the app must handle a user granting only one (Google's granular consent).
- FR-3.3 After consent, list the user's GSC sites (`sites.list`) and GA4 properties (Analytics Admin API `accountSummaries.list`); user selects one of each (or skips one).
- FR-3.4 Refresh token encrypted and stored per §8.2. Access tokens are kept in memory only.
- FR-3.5 On `invalid_grant` or revoked access: mark connection `needs_reauth`, stop syncing, email the owner, show a "Reconnect" banner.
- FR-3.6 **Disconnect** button: revoke the token at Google's revoke endpoint, delete the encrypted token, and (user's choice) delete or keep cached metrics.

### Module 4 — Data sync
- FR-4.1 Vercel Cron calls `/api/cron/sync` daily. The endpoint rejects any request without `Authorization: Bearer ${CRON_SECRET}`.
- FR-4.2 The cron job fans out one job per connected org (batches small enough to finish within the function time limit). Use a Redis lock so two runs never sync the same org at once.
- FR-4.3 GSC: pull the last 16 months on first sync, then a rolling last 10 days daily (GSC data arrives with a 2–3 day delay, so recent days are re-fetched and upserted).
- FR-4.4 GA4: sessions, users, traffic source, and **key events** (GA4's current name for conversions), daily.
- FR-4.5 DataForSEO competitor data refreshed weekly per org.
- FR-4.6 Retries with exponential backoff on 429/5xx; respect Google quotas. Every run writes a `sync_runs` row (status, counts, error code — never token values).
- FR-4.7 Dashboard always shows "Data last updated: …" and flags stale data (> 48h).

### Module 5 — Dashboard
- FR-5.1 Top cards: organic clicks, impressions, average position (GSC); sessions and key events (GA4); estimated competitor ad spend on shared keywords (DataForSEO) — clearly labeled **"estimate."**
- FR-5.2 Trend charts (28 / 90 days, compare to previous period).
- FR-5.3 Top queries table with position and click-through rate.
- FR-5.4 Works with any combination of sources connected; missing sources show a setup prompt rather than empty charts.

### Module 6 — Keyword gap analysis
- FR-6.1 Match GSC queries against competitor paid keywords (normalized: lowercase, trimmed, simple plural/stem matching).
- FR-6.2 **Rescue Target** = competitor bids on the keyword AND the user's average position is between 11 and 30 (pages 2–3) AND impressions ≥ a configurable minimum.
- FR-6.3 Score = estimated CPC × search volume × position-opportunity factor. Top 10 go to the action checklist.

### Module 7 — AI action checklist (Gemini)
- FR-7.1 Weekly generation per org, plus on-demand (rate-limited to 5/day/org).
- FR-7.2 Gemini receives structured JSON only (metrics + keyword lists), never raw competitor web pages. Competitor ad text is passed inside a clearly delimited data field with an instruction that it is untrusted.
- FR-7.3 Output must validate against a Zod schema (title, why, steps, suggested copy, keyword, priority). Invalid output is discarded and retried once.
- FR-7.4 All AI copy is labeled **"AI draft — review before publishing."** It must not name competitors or make claims about them.
- FR-7.5 Users can mark items done, dismissed, or snoozed.

### Module 8 — Settings, privacy and deletion
- FR-8.1 Export my data (CSV/JSON).
- FR-8.2 Delete organization: revokes Google tokens, hard-deletes all org data within 30 days (immediately from the app; from backups per Neon retention).
- FR-8.3 Privacy policy and terms pages linked in the footer and on the consent screen.

### Module 10 — Trial, billing and lifecycle
- FR-10.1 Trial: 7 days from organization creation (gate completion). No card required. One trial per organization; a user may not start a new trial for the same website domain within 90 days (abuse control).
- FR-10.2 Status per org: `trialing` → `active` (paid) or `locked` (trial ended unpaid, or payment failed past Stripe's retry period) → `deleted`. `past_due` keeps access during Stripe's retry window.
- FR-10.3 Plans: monthly and annual (prices TBD by owner). Subscribe via Stripe Checkout; manage/cancel via Stripe Customer Portal. Only owners see billing.
- FR-10.4 Stripe webhooks are the source of truth for subscription status. Verify every webhook signature; process idempotently (store event ids); never trust plan or price data from the browser.
- FR-10.5 Locked org: every dashboard page shows only the lock screen and "Add a card to unlock"; data sync stops. Owners can still export or delete their data.
- FR-10.6 30 days after locking (or immediately on owner request): revoke Google tokens, hard-delete org data (as FR-8.2). Email reminders: trial day 5, day 7, lock day, and 7 days before deletion.
- FR-10.7 A daily cron applies trial expiry and scheduled deletions; the dashboard also checks status on every request so access never depends on the cron having run.

### Module 9 — Admin
- FR-9.1 Admin page (role-gated) showing sync success rates, failing orgs by error code, API spend vs. caps.
- FR-9.2 No admin view of an org's Google metrics.

## 6. Google integration details

### 6.1 Google Cloud project setup (owner does this with Claude's step-by-step help)
1. Create a Google Cloud project for production (and a separate one for development).
2. Enable: Google Search Console API, Google Analytics Data API, Google Analytics Admin API.
3. Configure the OAuth consent screen: app name, support email, logo, homepage, privacy policy URL, terms URL, authorized domain.
4. Create OAuth client (Web). Redirect URIs: `https://<prod-domain>/api/google/callback` and the local dev URL. **Do not** add wildcard preview URLs; test Google connection on a fixed staging domain.

### 6.2 Verification
- The read-only Search Console and Analytics scopes are treated by Google as **sensitive** scopes, which require app verification before the public can use the app without warnings. Expect to provide: verified domain ownership, privacy policy describing Google data use, a justification per scope, and a demo video of the consent and data-use flow.
- While the app is in "Testing" mode, only listed test users can connect, and **refresh tokens expire after 7 days**. Do not treat this as a bug.
- Plan 2–6 weeks for verification; start it as soon as Phase 3 works on staging.

### 6.3 Scopes (exact list — no others without owner approval)
- `openid`, `email`, `profile` (login only)
- `https://www.googleapis.com/auth/webmasters.readonly`
- `https://www.googleapis.com/auth/analytics.readonly`

### 6.4 Google API Services User Data Policy (Limited Use)
Google user data is used **only** to show the user their own dashboard and generate their own recommendations. It is never sold, never used for ads, never used to train AI models, and never read by staff except with the user's permission for support, for security, or as required by law. This text goes into the privacy policy.

## 7. Data model (Drizzle / Postgres)

All tenant tables have `org_id` and RLS enabled. All IDs are UUIDv7 unless noted.

- `users` (id, email, name, created_at)
- `organizations` (id, name, website_domain, service_area, category, primary_goal, ad_spend_range, website_manager, plan_status [`trialing`|`active`|`past_due`|`locked`], trial_ends_at, locked_at, delete_after, stripe_customer_id, stripe_subscription_id, created_at)
- `stripe_events` (id = Stripe event id, type, processed_at) — idempotency for webhooks
- `memberships` (org_id, user_id, role)
- `invites` (id, org_id, email, token_hash, expires_at, accepted_at)
- `google_connections` (id, org_id, connected_by_user_id, google_account_email, granted_scopes[], **refresh_token_ciphertext**, token_iv, token_auth_tag, key_version, status [`active`|`needs_reauth`|`revoked`], last_refreshed_at)
- `linked_properties` (id, org_id, connection_id, type [`gsc`|`ga4`], external_id, display_name)
- `gsc_daily` (org_id, date, clicks, impressions, ctr, position) — PK (org_id, date)
- `gsc_query_daily` (org_id, date, query, clicks, impressions, position) — PK (org_id, date, query)
- `ga4_daily` (org_id, date, sessions, users, key_events, source_medium) — PK (org_id, date, source_medium)
- `competitor_keywords` (org_id, keyword, competitor_domain, est_cpc_cents, search_volume, fetched_at)
- `keyword_gaps` (org_id, keyword, user_position, est_cpc_cents, score, computed_at)
- `action_items` (id, org_id, title, why, steps_json, suggested_copy, keyword, priority, status, created_at)
- `ai_generations` (id, org_id, model, input_hash, tokens_in, tokens_out, status, created_at) — no prompt text containing Google data retained beyond 30 days
- `public_snapshots` (id [random 22+ chars], domain, location, result_json, ip_hash, expires_at)
- `sync_runs` (id, org_id, source, status, rows_upserted, error_code, started_at, finished_at)
- `audit_log` (id, org_id, actor_user_id, action, metadata_json, created_at) — logs connect, disconnect, invite, export, delete, role change
- `api_spend_daily` (date, provider, cents)

## 8. Security architecture

### 8.1 Principles
Least privilege, read-only Google access, secrets server-side, encryption for tokens, tenant isolation enforced twice (app + database), everything auditable.

### 8.2 Token encryption
- AES-256-GCM using Node's `crypto`. Random 12-byte IV per encryption; store IV and auth tag alongside ciphertext.
- Key from `TOKEN_ENCRYPTION_KEY` (32 random bytes, base64) set as a **Sensitive** environment variable in Vercel, production only. Different key for preview/dev.
- `key_version` column allows key rotation: new key encrypts, old key still decrypts until a rotation job re-encrypts everything.
- Only `src/server/google/tokens.ts` may decrypt. Unit tests verify round-trip and tamper detection.

### 8.3 Tenant isolation
- App helper `withOrg(orgId, fn)` opens a transaction, verifies the current user's membership, runs `SELECT set_config('app.org_id', orgId, true)`, then runs `fn`.
- RLS policy on every tenant table: `org_id = current_setting('app.org_id')::uuid`.
- The runtime database role (`app_user`) is **not** the table owner and does not have `BYPASSRLS`. Migrations run as a separate owner role. Use `FORCE ROW LEVEL SECURITY`.
- Cron uses a dedicated path that calls `withOrg` per org.
- Test: user of org A attempting to read org B data via every API route returns 404/403.

### 8.4 Web security
- Auth.js secure, HttpOnly, SameSite=Lax session cookies; CSRF protection on mutations.
- Security headers via `next.config`: strict Content-Security-Policy, HSTS, X-Content-Type-Options, Referrer-Policy, frame-ancestors 'none'.
- No `dangerouslySetInnerHTML` anywhere. AI and competitor text rendered as plain text.
- Rate limits (Upstash): login emails, snapshot, AI generation, invites.
- Vercel Deployment Protection enabled on previews.
- Dependabot (or Renovate) + `npm audit` in CI; lockfile committed.

### 8.5 Logging
- Structured logs with a redaction list: `refresh_token`, `access_token`, `authorization`, `code`, `client_secret`, email bodies.
- Sentry `beforeSend` scrubs the same fields.

## 9. Environment variables (`.env.example`)

```
DATABASE_URL=                 # Neon pooled, app_user role
DATABASE_URL_UNPOOLED=        # Neon direct, migration owner role
AUTH_SECRET=
AUTH_URL=
GOOGLE_LOGIN_CLIENT_ID=
GOOGLE_LOGIN_CLIENT_SECRET=
GOOGLE_DATA_CLIENT_ID=
GOOGLE_DATA_CLIENT_SECRET=
GOOGLE_DATA_REDIRECT_URI=
TOKEN_ENCRYPTION_KEY=
TOKEN_ENCRYPTION_KEY_VERSION=1
DATAFORSEO_LOGIN=
DATAFORSEO_PASSWORD=
GEMINI_API_KEY=
GEMINI_MODEL=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
TURNSTILE_SITE_KEY=           # the only value allowed in the browser (as NEXT_PUBLIC_TURNSTILE_SITE_KEY)
TURNSTILE_SECRET_KEY=
RESEND_API_KEY=
CRON_SECRET=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_MONTHLY=
STRIPE_PRICE_ANNUAL=
SENTRY_DSN=
DAILY_SPEND_CAP_DATAFORSEO_CENTS=
DAILY_SPEND_CAP_GEMINI_CENTS=
```

## 10. Non-functional requirements
- Dashboard loads from cached data in < 2 s (p75). No live Google calls on page load.
- 99.5% monthly uptime target.
- Accessibility: WCAG 2.1 AA basics (contrast, labels, keyboard navigation).
- English at launch; French-ready (all strings in a translation file) for Quebec.
- Canadian privacy: PIPEDA-aligned privacy policy; Quebec Law 25 considerations reviewed by counsel before marketing in Quebec.

## 11. Suggested folder structure

```
src/
  app/                 # routes (public, (app) signed-in, api)
  components/
  server/
    db/                # drizzle schema, withOrg helper, migrations
    google/            # oauth, tokens (only decrypt point), gsc, ga4
    dataforseo/
    ai/                # gemini client, prompts, zod output schemas
    sync/              # cron fan-out and per-org jobs
    security/          # rate limit, turnstile, headers, redaction
  lib/                 # shared non-secret utilities
tests/
```

## 12. Build phases (stop and report after each)

| Phase | Deliverable | Acceptance checks |
|---|---|---|
| 0. Setup | Repo, Next.js, Vercel project, Neon integration, Drizzle, CI (lint, typecheck, tests), `.env.example` | Preview deploy works; CI green; no secrets in git |
| 1. Auth & orgs | Login, orgs, memberships, invites, RLS + `withOrg`, gate questions, trial clock + lock screen | Tenant-isolation tests pass; trial expiry locks the dashboard |
| 2. Assessment & gate | Home-page assessment, Turnstile, rate limits, DataForSEO + Gemini, cache, spend caps, teaser with server-side locked sections, gate → org + trial, snapshot attached to org | Abuse test: 4th request/day blocked; caps enforced; locked content absent from page source |
| 3. Google connect | Data OAuth flow, encryption, property picker, disconnect/revoke | Token never appears in logs, responses, or DB plaintext |
| 4. Sync | Cron, fan-out, backfill, retries, `sync_runs`, reauth handling | Cron without secret → 401; revoked token → `needs_reauth` |
| 5. Dashboard | Cards, charts, queries table, stale-data banner | Works with GSC only, GA4 only, both, neither |
| 6. Gaps & AI | Keyword gap scoring, Rescue Targets, checklist | Zod-invalid AI output rejected; injection test string in competitor copy has no effect |
| 6b. Billing & lifecycle | Stripe Checkout/Portal, webhooks, lock/unlock, reminder emails, 30-day deletion job | Forged webhook rejected; replayed webhook ignored; unpaid org locks on day 8 and is deleted on day 38 (time-travel test) |
| 7. Hardening & launch | Headers, Sentry, export/delete, privacy policy, Google verification package | Security checklist 100%; verification submitted |

## 13. Security checklist (run at end of every phase)
- [ ] No secret uses a `NEXT_PUBLIC_` prefix (except the Turnstile site key)
- [ ] `git log` and repo contain no secrets
- [ ] Every new table with customer data has `org_id` + RLS + an isolation test
- [ ] Every new route validates input with Zod and checks auth/role
- [ ] No token or credential appears in logs, Sentry, or API responses
- [ ] Only the scopes in §6.3 are requested
- [ ] No `dangerouslySetInnerHTML`
- [ ] Rate limits exist on any endpoint that costs money or sends email
- [ ] `npm audit` shows no high/critical issues
- [ ] Locked/gated content is never sent to the browser (check page source and RSC payload)
- [ ] Stripe webhooks verify signatures and are idempotent; no card data touches our servers

## 14. Open questions for the owner
1. ~~Product name~~ — **TorqueRank** (decided; trademark check by counsel pending). Domains: torquerank.ca (primary) + torquerank.com (available, not yet purchased).
2. ~~Pricing model~~ — decided: 7-day no-card trial (clock starts at the gate), then monthly or annual plan; unpaid dashboards lock on day 8 and are deleted 30 days later. **Still open: the monthly and annual prices**, and whether plans differ (e.g., number of locations/properties).
3. Which email address becomes the Google Cloud and Vercel owner account (should be a company account, not personal, with 2-step verification on).
4. Legal review of privacy policy and terms before Google verification.
