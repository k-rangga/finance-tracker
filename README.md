# Personal Spending Tracker (Maxie)

Tracks spending per pay cycle (customizable payday, default 25th moved to Friday when it falls on a weekend), compares it to category budgets, shows a savings plan and keeps an investment journal. Transactions are imported from receipts in one Gmail label.

It supports two backends using the same React UI:
- **Vercel + Supabase** (`api/`, `server/`, `supabase/`): hosted web app with email + PIN sign-in, Google OAuth for Gmail/Drive, and scheduled sync via `api/cron.ts` (see [docs/vercel-setup.md](docs/vercel-setup.md)).
- **Google Apps Script web app** (`apps-script/`): single-file `Index.html` backed by a Google Sheet in your Drive.

## Files

| Path | What it is |
|---|---|
| `src/` | React + TypeScript UI (Vite, CSS modules). Talks to Apps Script or `/api/rpc` (`src/lib/gas.ts`). |
| `api/` & `server/` | Vercel API endpoints (`/api/rpc`, `/api/cron`, `/api/google/callback`) and Supabase/Google engine. |
| `apps-script/Code.js` | `doGet`, and `api(action, payload)` — the Apps Script entry point |
| `apps-script/Sheets.js` | Spreadsheet storage (tabs below), plain-text cells, script lock on writes |
| `apps-script/Gmail.js` | Label list, chosen label, sync, scheduled trigger |
| `apps-script/Parse.js` | Turns a receipt email into amount, currency, category, source and merchant |
| `apps-script/Index.html` | **Generated** by `npm run build` — don't edit by hand |
| `apps-script/appsscript.json` | Manifest: runs as the owner, access only the owner |

## Data

In Apps Script mode, data lives in spreadsheet **"Personal Spending Tracker — data"** in your Drive (`SPREADSHEET_ID` script property). In Vercel mode, the equivalent tables live in Supabase (`supabase/schema.sql`).

| Tab | Columns |
|---|---|
| `transactions` | id (Gmail message id), occurred_at, title, category, amount, currency, source, sender, subject, imported_at |
| `overrides` | tx_id, category, updated_at — your re-categorisations; the original parse is kept |
| `trades` | the investment journal (one row per entry, exit fields filled when closed) |
| `snapshots` | day, value, contributed — one portfolio value per day for the Progress chart |

Settings, the latest prices and the Gmail sync status are stored in properties (`settings`, `prices`, `gmail`).

## Gmail sync

Choose the label in the app (header chip → Gmail sync). Choosing it imports the last 62 days immediately; **Sync now** imports new mail immediately; automatic sync runs every 2 hours in Asia/Jakarta time (00:00–22:00 WIB). Mail is only read (`gmail.readonly`).

## Develop and deploy

```bash
npm install
npm run dev        # local UI with a browser-storage stand-in for the server (no Gmail)
npm run typecheck  # TypeScript check for UI and server
npm test           # parse/dedupe, server engine, and installment plan tests
npm run build:web  # Vercel production build
npm run push       # build Index.html and clasp push (uses `clasp login --user personal`)
npm run deploy     # push + update the Apps Script web app deployment (same URL)
```

First run (Apps Script): open the script in the editor, run `setup`, and approve the permissions (Advanced → Go to project, since it's your own unverified script). That creates the spreadsheet and trigger. Then open the web app URL.

- **Logo:** inline SVG Siberian husky mark in `src/components/Logo.tsx`.
- **Settings** (sidebar → Settings): name, city, Maxie language, income, payday, currency, warning threshold, savings/invest %, market caps, USD rate.
