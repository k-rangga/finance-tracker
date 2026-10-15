-- Personal Spending Tracker: per-user data. Every table is keyed by user_id and
-- protected by row-level security so a signed-in user only sees their own rows.

create table if not exists public.user_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  income double precision not null check (income > 0),
  currency text not null check (currency in ('IDR', 'USD')),
  warn_at integer not null check (warn_at between 60 and 95),
  invest_pct double precision not null check (invest_pct between 0 and 100),
  idx_cap double precision not null check (idx_cap between 0 and 100),
  us_cap double precision not null check (us_cap between 0 and 100),
  crypto_cap double precision not null check (crypto_cap between 0 and 100),
  fx_rate double precision not null check (fx_rate > 0),
  prices_updated_on date,
  updated_at timestamptz not null default now()
);

-- User re-categorisations of imported transactions.
create table if not exists public.transaction_overrides (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  tx_id text not null,
  category text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, tx_id)
);

create table if not exists public.trades (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  market text not null check (market in ('IDX', 'US', 'Crypto')),
  ticker text not null,
  name text not null default '',
  buy_date date not null,
  price double precision not null check (price > 0),
  quantity double precision not null check (quantity > 0),
  fee double precision,
  style text not null check (style in ('Long-term', 'Swing')),
  conviction smallint not null check (conviction between 1 and 5),
  target double precision,
  stop double precision,
  catalyst text,
  catalyst_date date,
  thesis text not null default '',
  tags text,
  leverage double precision,
  direction text check (direction in ('Long', 'Short')),
  exit_price double precision,
  exit_date date,
  followed_plan text check (followed_plan in ('Yes', 'Partly', 'No')),
  rating smallint check (rating between 1 and 5),
  lesson text,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- Latest price per ticker from the weekly price update.
create table if not exists public.prices (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  ticker text not null,
  price double precision not null check (price > 0),
  primary key (user_id, ticker)
);

-- One portfolio value point per day, for the Progress chart.
create table if not exists public.portfolio_snapshots (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day date not null,
  value double precision not null,
  contributed double precision not null,
  primary key (user_id, day)
);

do $$
declare t text;
begin
  foreach t in array array['user_settings', 'transaction_overrides', 'trades', 'prices', 'portfolio_snapshots'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t
    );
  end loop;
end $$;
