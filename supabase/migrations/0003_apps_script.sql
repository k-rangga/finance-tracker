-- Gmail is now read by the user's own Apps Script, which authenticates to /api/ingest
-- with a per-user connection key. The Google OAuth token tables are no longer used.

drop table if exists public.gmail_tokens;
drop table if exists public.gmail_oauth_states;

-- Any connection made through the old OAuth flow can't be used by the script.
delete from public.gmail_connections;

alter table public.gmail_connections drop column if exists label_id;
alter table public.gmail_connections add column if not exists key_hash text unique;
alter table public.gmail_connections add column if not exists labels jsonb not null default '[]'::jsonb;
alter table public.gmail_connections add column if not exists script_seen_at timestamptz;
alter table public.gmail_connections add column if not exists sync_requested boolean not null default false;

-- The browser reads status through the existing "read own" policy; the key hash is never selected by the app.
