-- Sturoids cloud sync. Applied to the "sturoids" project (ap-south-1); running it again is safe.
-- Every user can only ever see and change their own data.

-- Attachments (photos, videos, files), at most 20 MB each, in a private bucket.
insert into storage.buckets (id, name, public, file_size_limit)
values ('backups', 'backups', false, 20971520)
on conflict (id) do update set public = false, file_size_limit = 20971520;

-- Files live under a folder named after the user's id: <user id>/att/<attachment id>.
drop policy if exists "backups: read own files" on storage.objects;
create policy "backups: read own files" on storage.objects
  for select to authenticated
  using (bucket_id = 'backups' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "backups: add own files" on storage.objects;
create policy "backups: add own files" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'backups' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "backups: replace own files" on storage.objects;
create policy "backups: replace own files" on storage.objects
  for update to authenticated
  using (bucket_id = 'backups' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'backups' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "backups: delete own files" on storage.objects;
create policy "backups: delete own files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'backups' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- The data itself (notes, journal, tasks, scores, settings): one row per user, in the database.
create table if not exists public.backups (
  user_id uuid primary key references auth.users (id) on delete cascade,
  snapshot text not null,
  device text,
  app_version text,
  bytes bigint not null default 0,
  files integer not null default 0,
  updated_at timestamptz not null default now()
);
-- which install wrote the copy, so another phone signed in to the same account can tell the copy is not its own
alter table public.backups add column if not exists device_id text;

alter table public.backups enable row level security;

drop policy if exists "backups: own row" on public.backups;
create policy "backups: own row" on public.backups
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Lets a signed-in user delete their own account. The app removes their files first;
-- deleting the account then removes their row.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- The free plan's 1 GB of files is shared, so the app is for a handful of friends: at most eight accounts.
create or replace function public.limit_accounts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from auth.users) >= 8 then
    raise exception 'sturoids: accounts are full';
  end if;
  return new;
end;
$$;

revoke all on function public.limit_accounts() from public, anon, authenticated;

drop trigger if exists limit_accounts on auth.users;
create trigger limit_accounts before insert on auth.users
  for each row execute function public.limit_accounts();

-- How much a user keeps in files, so the app can hold each account to its share (120 MB).
create or replace function public.my_storage_bytes()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum((metadata ->> 'size')::bigint), 0)
  from storage.objects
  where bucket_id = 'backups' and (storage.foldername(name))[1] = (select auth.uid())::text;
$$;

revoke all on function public.my_storage_bytes() from public, anon;
grant execute on function public.my_storage_bytes() to authenticated;
