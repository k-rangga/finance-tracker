# Personal Spending Tracker

Tracks spending per pay cycle (25th to 25th, moved to Friday when it falls on a weekend), compares it to category budgets, shows a savings plan and keeps an investment journal.

React 18 + TypeScript + Vite, CSS modules. User data lives in **Supabase Postgres** (provisioned through the Vercel Marketplace) with row-level security, so each account only reads and writes its own rows. Without Supabase env vars the app falls back to browser storage and a demo sign-in.

```bash
npm install
npm run dev
```

- **Logo:** drop the real cat logo at `public/assets/logo-cat.png`; until then a placeholder SVG is used.
- **Env:** `vercel env pull` writes the Supabase vars to `.env.local` (`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` are exposed to the browser via `envPrefix`).
- **Schema:** `supabase/migrations/0001_init.sql` — tables `user_settings`, `transaction_overrides`, `trades`, `prices`, `portfolio_snapshots`. On first sign-in, data already in that browser is copied into the account.
- **Auth:** Supabase email + password. Google sign-in needs the Google provider enabled in the Supabase dashboard (Authentication → Providers) with an OAuth client from Google Cloud. Add your site URLs under Authentication → URL Configuration.
- **Transactions:** `src/data/transactions.ts` returns demo receipts scaled to your income; replace `loadCycleTransactions` with the Gmail import.
- **Settings** (sidebar → Settings): income, currency, warning threshold, invest %, market caps, USD rate.
