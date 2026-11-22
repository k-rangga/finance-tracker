# Moving to Vercel + Supabase

The same app, served by Vercel, with your data in Supabase. On Vercel, the server runs the existing Apps Script code
(`apps-script/*.js`) unchanged, through `server/engine.ts`: the Sheet becomes your Supabase rows, and Gmail and Drive
are read with your own Google connection. The Apps Script version keeps working until you switch.

You do every step that involves an account, a password or a secret key. Keys you paste go only into Supabase, Google
Cloud, Vercel or Apps Script settings, never into the code or a chat.

## 1. Supabase (database and sign-in)

1. Create a free project at supabase.com. Pick the **Singapore** region (closest to Jakarta and to Vercel's `sin1`).
2. **SQL Editor → New query**: paste all of `supabase/schema.sql` and press Run.
3. **Authentication → Sign In / Providers → Email**: keep it on. Turn off **Allow new users to sign up** after you
   (and anyone you invite) have signed in once.
4. **Authentication → URL Configuration**: set **Site URL** to your Vercel address (step 3), and add it under
   **Redirect URLs**.
5. **Project Settings → API Keys**: note the **Project URL**, the **publishable key** (public) and the **secret key**
   (keep it secret).

### Sign-in emails

The default Supabase emails are plain. `supabase/email-templates/` has branded ones (button, 6-digit code, who
it's for). In Supabase → **Authentication → Emails → Templates**:

| Template | Subject | Body |
|---|---|---|
| **Magic link** | `Your sign-in link for Personal Spending Tracker` | `magic-link.html` |
| **Confirm signup** | `Confirm your email for Personal Spending Tracker` | `confirm-signup.html` |

Paste the whole file into the body (Source view) and save.

To send from your own name and address instead of Supabase's (and beyond its few emails an hour), set up
**Authentication → Emails → SMTP Settings** with a mail provider (for example Resend, or Gmail with an app
password): sender name `Personal Spending Tracker`, your own email address.

## 2. Google Cloud (Gmail and Drive)

1. At console.cloud.google.com, create a project, e.g. "Spending tracker".
2. **APIs & Services → Library**: enable **Gmail API** and **Google Drive API**.
3. **Google Auth Platform → Branding**: app name, your email. **Audience**: External, then **Publish app**
   (In production). Don't leave it in Testing: there, connections expire every 7 days.
4. **Data Access → Add scopes**: `openid`, `email`, `.../auth/gmail.readonly`, `.../auth/drive`.
5. **Clients → Create client → Web application**. Authorized redirect URI:
   `https://YOUR-APP.vercel.app/api/google/callback`. Note the **Client ID** and **Client secret**.

Until Google verifies the app (only needed past 100 users), each person sees "Google hasn't verified this app" once
and chooses **Advanced → Continue**.

## 3. Vercel (the app)

1. At vercel.com, **Add New → Project → Import** `k-rangga/finance-tracker`. Vercel reads `vercel.json`
   (build `npm run build:web`, output `dist`, functions in Singapore).
2. **Settings → Environment Variables** (Production and Preview):

   | Name | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | Supabase Project URL |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key |
   | `SUPABASE_URL` | Supabase Project URL (again, for the server) |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase **secret** key |
   | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | from Google Cloud |
   | `GEMINI_API_KEY` | your Gemini key (same as in Apps Script) |
   | `GEMINI_MODEL` | optional, as in Apps Script |
   | `CRON_SECRET` | any long random text |
   | `ALLOWED_EMAILS` | optional: comma-separated emails allowed to use the app |

3. Deploy. Open the app, enter your email, open the link, and you're in (empty at first).

## 4. Hourly sync

In Supabase: **Database → Extensions**, enable `pg_cron` and `pg_net`. Then, in the SQL Editor, run the commented
`cron.schedule(...)` block at the end of `schema.sql`, with your app URL and `CRON_SECRET` filled in.

## 5. Copy your data

1. In Supabase → **Authentication → Users**, copy your **User UID**.
2. In the Apps Script editor → **Project Settings → Script properties**, add `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_USER_ID`.
3. Run **`copyToSupabase`** (Export.js) from the editor. The log lists how many rows each table copied.
   Safe to run again later: rows are updated, never duplicated.
4. In the Vercel app: **Gmail sync → Connect Google**, then choose your receipts label.
5. Compare totals with the Apps Script app for a few days.

## 6. Switch

1. Remove the Apps Script hourly trigger (editor → Triggers → `scheduledSync` → delete), so receipts aren't imported
   twice.
2. Delete `SUPABASE_SERVICE_ROLE_KEY` from Script properties.
3. Use the Vercel address from now on.

## Developing

- `npm run dev`: the app with local stand-in data, as before.
- `npm test`: receipt parsing, plus the engine and Supabase store against an in-memory database.
- `node scripts/gen-schema.mjs > supabase/schema.sql` after adding a column to `TABLES` in `Sheets.js`; run the new
  SQL in Supabase.
