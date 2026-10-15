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

## Gmail sync (Apps Script)

Gmail is read by your own Google Apps Script (`apps-script/`), so no Google Cloud OAuth app or verification is needed.

- `apps-script/Code.js` — reads one Gmail label read-only and posts the emails to `/api/ingest/*`, authenticated with a per-user **connection key** (`INGEST_KEY` script property; only its SHA-256 is stored). Triggers: daily at 06:00 (Asia/Jakarta) plus a 10-minute check for "Sync now" and label changes made in the app. The script also reports your label list so you choose the label in the app.
- `api/ingest/poll`, `api/ingest/messages` — called by the script; receipts are parsed server-side (`api/_lib/parse.ts`).
- `api/gmail/key|label|sync|disconnect` — called by the app.
- Deploy the script: `cd apps-script && clasp push` (`.clasp.json` holds the script ID and is git-ignored). Then in the app: Gmail sync → Create connection key → add it as `INGEST_KEY` in Project Settings → Script Properties → run `setup` once.

- **Logo:** drop the real cat logo at `public/assets/logo-cat.png`; until then a placeholder SVG is used.
- **Settings** (sidebar → Settings): income, currency, warning threshold, invest %, market caps, USD rate.
