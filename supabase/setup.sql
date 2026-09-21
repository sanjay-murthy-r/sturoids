-- Sturoids cloud backup. Run once in the Supabase SQL Editor of your project.
-- Every user can only ever see and change their own backup.

-- Attachments (photos, videos, files), at most 20 MB each, in a private bucket.
insert into storage.buckets (id, name, public, file_size_limit)
values ('backups', 'backups', false, 20971520)
on conflict (id) do update set public = false, file_size_limit = 20971520;

-- Files live under a folder named after the user's id: <user id>/att/<attachment id>.
create policy "backups: read own files" on storage.objects
  for select to authenticated
  using (bucket_id = 'backups' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "backups: add own files" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'backups' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "backups: replace own files" on storage.objects
  for update to authenticated
  using (bucket_id = 'backups' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'backups' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "backups: delete own files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'backups' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- The data itself (notes, journal, tasks, scores, settings): one row per user.
-- It lives in the database, so it never uses file storage.
create table if not exists public.backups (
  user_id uuid primary key references auth.users (id) on delete cascade,
  snapshot text not null,
  device text,
  app_version text,
  bytes bigint not null default 0,
  files integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.backups enable row level security;

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
