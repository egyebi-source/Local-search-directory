# TorqueRank

Helps small businesses see whether their online presence produces clicks, visits and leads, and
what to fix this week. Full spec: [`PRD.md`](PRD.md). Rules for AI-assisted work: [`CLAUDE.md`](CLAUDE.md).

## Stack

Next.js 16 (App Router, TypeScript strict) on Vercel · Neon Postgres · Drizzle ORM · Zod · Tailwind ·
Vitest. See PRD §4.

## Local development

```bash
npm install
vercel env pull .env.local   # pulls development settings from Vercel (never commit this file)
npm run dev
```

| Command | What it does |
|---|---|
| `npm run lint` | Code style checks |
| `npm run typecheck` | TypeScript type checks |
| `npm test` | Unit tests |
| `npm run build` | Production build |
| `npm run db:generate` | Create a migration from `src/server/db/schema.ts` |
| `npm run db:migrate` | Apply migrations (uses `DATABASE_URL_UNPOOLED`, the owner role) |

`GET /api/health` returns `{"status":"ok","database":"ok"}` when the app can reach its database.

## Security at a glance

- Secrets live only in Vercel environment variables (marked Sensitive) and `.env.local`; `.env*`
  files are git-ignored. Only `NEXT_PUBLIC_TURNSTILE_SITE_KEY` may reach the browser, and a test
  enforces it.
- Every HTML page gets a per-request nonce Content-Security-Policy (`src/proxy.ts`); all responses get
  HSTS, nosniff, Referrer-Policy and anti-framing headers (`next.config.ts`).
- CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests, build, `npm audit` and a gitleaks
  secret scan on every push. Dependabot opens weekly update PRs.
