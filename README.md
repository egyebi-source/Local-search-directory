# TorqueRank

Helps small businesses see whether their online presence produces clicks, visits and leads, and
what to fix this week. Full spec: [`PRD.md`](PRD.md). Rules for AI-assisted work: [`CLAUDE.md`](CLAUDE.md).

## Stack

Next.js 16 (App Router, TypeScript strict) on Vercel · Neon Postgres · Drizzle ORM · Zod · Tailwind ·
Vitest. See PRD §4.

## Local development

```bash
npm install
cp .env.example .env.local    # then fill in DATABASE_URL and AUTH_SECRET (never commit .env.local)
npm run db:migrate            # needs DATABASE_URL_UNPOOLED (the owner role)
npm run dev
```

Without `RESEND_API_KEY`, sign-in and invite emails are printed to the terminal in local
development only. On Vercel an email provider is required.

### Tests

Unit tests run anywhere. Database tests (tenant isolation, invites, rate limits) need a
throwaway local Postgres whose name ends in `_test`, with an owner role and an `app_user`
role (see the CI workflow for the exact setup):

```bash
TEST_DATABASE_URL=postgresql://app_user:...@localhost/app_test \
TEST_DATABASE_URL_OWNER=postgresql://app_owner:...@localhost/app_test \
npm test
```

CI always runs them against a fresh Postgres.

| Command | What it does |
|---|---|
| `npm run lint` | Code style checks |
| `npm run typecheck` | TypeScript type checks |
| `npm test` | Unit tests |
| `npm run build` | Production build |
| `npm run db:generate` | Create a migration from `src/server/db/schema.ts` |
| `npm run db:migrate` | Apply migrations (uses `DATABASE_URL_UNPOOLED`, the owner role). Also runs automatically before every Vercel build. |

`GET /api/health` returns `{"status":"ok","database":"ok"}` when the app can reach its database.

## Security at a glance

- Secrets live only in Vercel environment variables (marked Sensitive) and `.env.local`; `.env*`
  files are git-ignored. Only `NEXT_PUBLIC_TURNSTILE_SITE_KEY` may reach the browser, and a test
  enforces it.
- Every HTML page gets a per-request nonce Content-Security-Policy (`src/proxy.ts`); all responses get
  HSTS, nosniff, Referrer-Policy and anti-framing headers (`next.config.ts`).
- Each business's data is separated twice: `withOrg()` checks membership in the app, and
  Postgres row-level security (`drizzle/0001_rls.sql`) blocks other businesses' rows. The app
  connects as `app_user`, which owns no tables and cannot bypass RLS.
- Google login tokens are discarded before they reach the database; invite tokens are stored
  only as SHA-256 hashes; sign-in and invite emails are rate-limited.
- CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests, build, `npm audit` and a gitleaks
  secret scan on every push. Dependabot opens weekly update PRs.
