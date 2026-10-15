# Personal Spending Tracker

Tracks spending per pay cycle (25th to 25th, moved to Friday when it falls on a weekend), compares it to category budgets, shows a savings plan and keeps an investment journal. Transactions are imported from receipts in one Gmail label.

It runs entirely as a **Google Apps Script web app**: the React UI is built into a single `Index.html`, the server is Apps Script, and data lives in a Google Sheet in your Drive. The web app runs as you and only you can open it, so Google handles sign-in.

## Files

| Path | What it is |
|---|---|
| `src/` | React + TypeScript UI (Vite, CSS modules). Talks to the server with `google.script.run` (`src/lib/gas.ts`). |
| `apps-script/Code.js` | `doGet`, and `api(action, payload)` — the single entry point the UI calls |
| `apps-script/Sheets.js` | Spreadsheet storage (tabs below), plain-text cells, script lock on writes |
| `apps-script/Gmail.js` | Label list, chosen label, sync, daily trigger |
| `apps-script/Parse.js` | Turns a receipt email into amount, currency, category, source and merchant |
| `apps-script/Index.html` | **Generated** by `npm run build` — don't edit by hand |
| `apps-script/appsscript.json` | Manifest: runs as the owner, access only the owner |

## Data

Spreadsheet **"Personal Spending Tracker — data"**, created in your Drive on first run (its ID is the `SPREADSHEET_ID` script property; set that property to use another spreadsheet).

| Tab | Columns |
|---|---|
| `transactions` | id (Gmail message id), occurred_at, title, category, amount, currency, source, sender, subject, imported_at |
| `overrides` | tx_id, category, updated_at — your re-categorisations; the original parse is kept |
| `trades` | the investment journal (one row per entry, exit fields filled when closed) |
| `snapshots` | day, value, contributed — one portfolio value per day for the Progress chart |

Settings, the latest prices and the Gmail sync status are JSON in script properties (`settings`, `prices`, `gmail`).

## Gmail sync

Choose the label in the app (header chip → Gmail sync). Choosing it imports the last 62 days immediately; **Sync now** imports new mail immediately; a time-driven trigger (`dailySync`) runs every day at 06:00 Asia/Jakarta. Mail is only read (`gmail.readonly`).

## Develop and deploy

```bash
npm install
npm run dev       # local UI with a browser-storage stand-in for the server (no Gmail)
npm run push      # build Index.html and clasp push (uses `clasp login --user personal`)
npm run deploy    # push + update the web app deployment (same URL)
```

First run: open the script in the editor, run `setup`, and approve the permissions (Advanced → Go to project, since it's your own unverified script). That creates the spreadsheet and the daily trigger. Then open the web app URL.

- **Logo:** replace `src/assets/logo-cat.svg` (or point `src/components/Logo.tsx` at a PNG).
- **Settings** (sidebar → Settings): income, currency, warning threshold, invest %, market caps, USD rate.
