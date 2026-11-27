-- Substack-style Journal tables + private Storage bucket for journal images.
-- Paste and run once in Supabase -> SQL Editor. Safe to re-run (idempotent).

create table if not exists public."journal_entries" (
  user_id uuid not null references auth.users (id) on delete cascade,
  "id" text not null,
  "account" text not null default 'all',
  "title" text not null default '',
  "subtitle" text not null default '',
  "body" text not null default '',
  "cover_path" text,
  "tags" jsonb not null default '[]'::jsonb,
  "status" text not null default 'published',
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now(),
  primary key (user_id, "id")
);

create index if not exists journal_entries_user_created on public."journal_entries" (user_id, created_at desc);
alter table public."journal_entries" enable row level security;
drop policy if exists "own rows" on public."journal_entries";
create policy "own rows" on public."journal_entries"
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create table if not exists public."journal_comments" (
  user_id uuid not null references auth.users (id) on delete cascade,
  "id" text not null,
  "entry_id" text not null,
  "body" text not null,
  "kind" text not null default 'note',
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now(),
  primary key (user_id, "id"),
  foreign key (user_id, "entry_id") references public."journal_entries" (user_id, "id") on delete cascade
);

create index if not exists journal_comments_entry_created on public."journal_comments" (user_id, entry_id, created_at asc);
alter table public."journal_comments" enable row level security;
drop policy if exists "own rows" on public."journal_comments";
create policy "own rows" on public."journal_comments"
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Private Storage bucket for inline & cover journal images (stored under <user_id>/<image_id>.<ext>).
insert into storage.buckets (id, name, public)
values ('journal-images', 'journal-images', false)
on conflict (id) do nothing;

drop policy if exists "journal images own select" on storage.objects;
create policy "journal images own select" on storage.objects
  for select to authenticated
  using (bucket_id = 'journal-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "journal images own insert" on storage.objects;
create policy "journal images own insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'journal-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "journal images own update" on storage.objects;
create policy "journal images own update" on storage.objects
  for update to authenticated
  using (bucket_id = 'journal-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "journal images own delete" on storage.objects;
create policy "journal images own delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'journal-images' and (storage.foldername(name))[1] = auth.uid()::text);
