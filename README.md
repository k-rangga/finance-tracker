# Personal Spending Tracker

Tracks spending per pay cycle (25th to 25th, moved to Friday when it falls on a weekend), compares it to category budgets, shows a savings plan and keeps an investment journal.

React 18 + TypeScript + Vite, CSS modules. Data lives in localStorage behind `src/lib/storage.ts` so it can be swapped for an API.

```bash
npm install
npm run dev
```

- **Logo:** drop the real cat logo at `public/assets/logo-cat.png`; until then a placeholder SVG is used.
- **Google sign-in:** set `VITE_GOOGLE_CLIENT_ID` in `.env.local` to use Google Identity Services (requests Gmail read-only for the receipt sync). Without it, both sign-in buttons start a demo session.
- **Transactions:** `src/data/transactions.ts` returns demo receipts scaled to your income; replace `loadCycleTransactions` with the Gmail import.
- **Settings** (sidebar → Settings): income, currency, warning threshold, invest %, market caps, USD rate.
