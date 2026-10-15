# Personal Spending Tracker

Tracks spending per pay cycle (25th to 25th, moved to Friday when it falls on a weekend), compares it to category budgets, shows a savings plan and keeps an investment journal.

React 18 + TypeScript + Vite, CSS modules. User data lives in **Supabase Postgres** (provisioned through the Vercel Marketplace) with row-level security, so each account only reads and writes its own rows. Without Supabase env vars the app falls back to browser storage and a demo sign-in.

```bash
npm install
vercel env pull   # Supabase + server env into .env.local
vercel dev        # app + /api functions (plain `npm run dev` serves the app only)
```

## Data

- **Supabase Postgres**, row-level security on every table. Migrations in `supabase/migrations/`.
- **Transactions** come only from Gmail: receipts under the label you choose are parsed (`api/_lib/parse.ts`) into amount, category and source. Re-categorising stores an override; the original parse is kept.
- **Investment journal, prices, settings** are entered by you. New accounts start empty.

## Gmail sync

- `api/gmail/*` — connect (Google OAuth, `gmail.readonly`, offline), list labels, choose label, sync now, disconnect. Refresh tokens live in `gmail_tokens`, readable only with the service role.
- `api/cron/gmail-sync` — Vercel Cron, daily at 23:00 UTC (06:00 WIB), syncs every user with a label. Protected by `CRON_SECRET`.
- Server env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (from the Supabase integration), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `CRON_SECRET`.
- Google Cloud: enable the Gmail API, add the `gmail.readonly` scope, create a Web OAuth client with redirect URI `https://<your-domain>/api/gmail/callback`. Keep the app's publishing status **In production** — in Testing, Google expires Gmail refresh tokens after 7 days and the daily sync stops.

- **Logo:** drop the real cat logo at `public/assets/logo-cat.png`; until then a placeholder SVG is used.
- **Settings** (sidebar → Settings): income, currency, warning threshold, invest %, market caps, USD rate.
