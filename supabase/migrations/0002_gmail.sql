-- Gmail receipt import.

-- Remove category overrides left over from the old demo transactions (ids t0, t1, …).
delete from public.transaction_overrides where tx_id ~ '^t[0-9]+$';

-- Transactions imported from Gmail. id = Gmail message id, so re-syncs are idempotent.
create table if not exists public.transactions (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  occurred_at timestamptz not null,
  title text not null,
  category text not null,
  amount double precision not null check (amount >= 0),
  currency text not null check (currency in ('IDR', 'USD')),
  source text not null,
  sender text,
  subject text,
  imported_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists transactions_user_time on public.transactions (user_id, occurred_at desc);

-- Connection status the browser may read (no secrets here).
create table if not exists public.gmail_connections (
  user_id uuid primary key references auth.users (id) on delete cascade,
  google_email text,
  label_id text,
  label_name text,
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz,
  last_sync_status text,
  last_sync_count integer
);

-- OAuth refresh tokens: server (service role) only, no policies.
create table if not exists public.gmail_tokens (
  user_id uuid primary key references auth.users (id) on delete cascade,
  refresh_token text not null,
  updated_at timestamptz not null default now()
);

-- Short-lived OAuth state values: server only.
create table if not exists public.gmail_oauth_states (
  state text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.transactions enable row level security;
drop policy if exists "own rows" on public.transactions;
create policy "own rows" on public.transactions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table public.gmail_connections enable row level security;
drop policy if exists "read own" on public.gmail_connections;
create policy "read own" on public.gmail_connections for select to authenticated using (user_id = (select auth.uid()));

alter table public.gmail_tokens enable row level security;
alter table public.gmail_oauth_states enable row level security;
