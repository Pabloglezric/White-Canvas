-- White Canvas — core schema
create extension if not exists pgcrypto with schema extensions;

-- ---------- profiles ----------
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null default '',
  color text not null default '#2f6fed',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(coalesce(new.email, 'Guest'), '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- boards ----------
create table public.boards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null default 'Untitled board',
  link_access text not null default 'none' check (link_access in ('none','view','comment','edit')),
  thumbnail text,
  settings jsonb not null default '{}'::jsonb,
  trashed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index boards_owner_idx on public.boards (owner_id);

create table public.board_members (
  board_id uuid not null references public.boards on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null check (role in ('viewer','commenter','editor')),
  via_link boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (board_id, user_id)
);
create index board_members_user_idx on public.board_members (user_id);

create table public.board_user_state (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  board_id uuid not null references public.boards on delete cascade,
  starred boolean not null default false,
  last_opened_at timestamptz,
  primary key (user_id, board_id)
);
create index board_user_state_board_idx on public.board_user_state (board_id);

-- ---------- items ----------
create table public.board_items (
  id uuid primary key,
  board_id uuid not null references public.boards on delete cascade,
  data jsonb not null,
  rev integer not null default 1,
  deleted boolean not null default false,
  client_id text,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create index board_items_board_idx on public.board_items (board_id) where not deleted;

create table public.board_versions (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards on delete cascade,
  name text not null default '',
  auto boolean not null default false,
  item_count integer not null default 0,
  snapshot jsonb not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index board_versions_board_idx on public.board_versions (board_id, created_at desc);

-- ---------- agent API tokens ----------
create table public.api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null default 'Agent token',
  token_hash text not null unique,
  prefix text not null default '',
  can_write boolean not null default true,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index api_tokens_user_idx on public.api_tokens (user_id);

-- ---------- role helpers ----------
create or replace function public.board_role(b uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when bo.owner_id = (select auth.uid()) then 'owner'
    else (select m.role from public.board_members m
          where m.board_id = bo.id and m.user_id = (select auth.uid()))
  end
  from public.boards bo where bo.id = b
$$;

create or replace function public.topic_board_role(topic text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare b uuid;
begin
  begin
    b := split_part(topic, ':', 2)::uuid;
  exception when others then
    return null;
  end;
  return public.board_role(b);
end $$;

-- Join a board through its share link (must be signed in).
create or replace function public.join_board(b uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  bo record;
  link_role text;
  existing text;
  uid uuid := (select auth.uid());
begin
  if uid is null then return null; end if;
  select id, owner_id, link_access into bo from public.boards where id = b and trashed_at is null;
  if not found then return null; end if;
  if bo.owner_id = uid then return 'owner'; end if;
  select role into existing from public.board_members where board_id = b and user_id = uid;
  link_role := case bo.link_access when 'view' then 'viewer' when 'comment' then 'commenter' when 'edit' then 'editor' else null end;
  if existing is not null then
    return existing;
  end if;
  if link_role is null then return null; end if;
  insert into public.board_members (board_id, user_id, role, via_link) values (b, uid, link_role, true);
  return link_role;
end $$;

-- Keep link-joined members in step with the link setting; only the owner may change sharing.
create or replace function public.boards_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  if uid is not null and uid <> old.owner_id then
    new.owner_id := old.owner_id;
    new.link_access := old.link_access;
    new.trashed_at := old.trashed_at;
  end if;
  if new.link_access is distinct from old.link_access then
    if new.link_access = 'none' then
      delete from public.board_members where board_id = new.id and via_link;
    else
      update public.board_members
        set role = case new.link_access when 'view' then 'viewer' when 'comment' then 'commenter' else 'editor' end
        where board_id = new.id and via_link;
    end if;
  end if;
  return new;
end $$;
create trigger boards_before_update before update on public.boards
  for each row execute function public.boards_before_update();

create or replace function public.board_items_touch() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  if (select auth.uid()) is not null then new.updated_by := (select auth.uid()); end if;
  update public.boards set updated_at = now()
    where id = new.board_id and updated_at < now() - interval '20 seconds';
  return new;
end $$;
create trigger board_items_touch before insert or update on public.board_items
  for each row execute function public.board_items_touch();

revoke execute on function public.board_role(uuid) from public, anon;
revoke execute on function public.topic_board_role(text) from public, anon;
revoke execute on function public.join_board(uuid) from public, anon;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.boards_before_update() from public, anon, authenticated;
revoke execute on function public.board_items_touch() from public, anon, authenticated;
grant execute on function public.board_role(uuid) to authenticated;
grant execute on function public.topic_board_role(text) to authenticated;
grant execute on function public.join_board(uuid) to authenticated;

-- ---------- RLS ----------
alter table public.profiles enable row level security;
alter table public.boards enable row level security;
alter table public.board_members enable row level security;
alter table public.board_user_state enable row level security;
alter table public.board_items enable row level security;
alter table public.board_versions enable row level security;
alter table public.api_tokens enable row level security;

create policy profiles_select on public.profiles for select to authenticated using (true);
create policy profiles_insert on public.profiles for insert to authenticated with check (id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy boards_select on public.boards for select to authenticated
  using (owner_id = (select auth.uid()) or public.board_role(id) is not null);
create policy boards_insert on public.boards for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy boards_update on public.boards for update to authenticated
  using (public.board_role(id) in ('owner','editor'))
  with check (public.board_role(id) in ('owner','editor'));
create policy boards_delete on public.boards for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy members_select on public.board_members for select to authenticated
  using (user_id = (select auth.uid()) or public.board_role(board_id) is not null);
create policy members_insert on public.board_members for insert to authenticated
  with check (public.board_role(board_id) = 'owner');
create policy members_update on public.board_members for update to authenticated
  using (public.board_role(board_id) = 'owner') with check (public.board_role(board_id) = 'owner');
create policy members_delete on public.board_members for delete to authenticated
  using (user_id = (select auth.uid()) or public.board_role(board_id) = 'owner');

create policy state_all on public.board_user_state for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy items_select on public.board_items for select to authenticated
  using (public.board_role(board_id) is not null);
create policy items_insert on public.board_items for insert to authenticated
  with check (
    public.board_role(board_id) in ('owner','editor')
    or (public.board_role(board_id) = 'commenter' and data->>'type' = 'comment')
  );
create policy items_update on public.board_items for update to authenticated
  using (
    public.board_role(board_id) in ('owner','editor')
    or (public.board_role(board_id) = 'commenter' and data->>'type' = 'comment')
  )
  with check (
    public.board_role(board_id) in ('owner','editor')
    or (public.board_role(board_id) = 'commenter' and data->>'type' = 'comment')
  );

create policy versions_select on public.board_versions for select to authenticated
  using (public.board_role(board_id) is not null);
create policy versions_insert on public.board_versions for insert to authenticated
  with check (public.board_role(board_id) in ('owner','editor'));
create policy versions_delete on public.board_versions for delete to authenticated
  using (public.board_role(board_id) = 'owner');

create policy tokens_all on public.api_tokens for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------- realtime ----------
alter publication supabase_realtime add table public.board_items;
alter publication supabase_realtime add table public.boards;

-- presence + cursors: any board role.  ops: editors only may send.
create policy board_channel_read on realtime.messages for select to authenticated
  using (
    (realtime.topic() like 'board:%' or realtime.topic() like 'ops:%')
    and public.topic_board_role(realtime.topic()) is not null
  );
create policy board_channel_write on realtime.messages for insert to authenticated
  with check (
    (realtime.topic() like 'board:%' and public.topic_board_role(realtime.topic()) is not null)
    or (realtime.topic() like 'ops:%' and public.topic_board_role(realtime.topic()) in ('owner','editor'))
  );

-- ---------- storage ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('board-assets', 'board-assets', false, 52428800)
on conflict (id) do nothing;

create or replace function public.asset_board_role(object_name text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare b uuid;
begin
  begin
    b := split_part(object_name, '/', 1)::uuid;
  exception when others then
    return null;
  end;
  return public.board_role(b);
end $$;
revoke execute on function public.asset_board_role(text) from public, anon;
grant execute on function public.asset_board_role(text) to authenticated;

create policy assets_select on storage.objects for select to authenticated
  using (bucket_id = 'board-assets' and public.asset_board_role(name) is not null);
create policy assets_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'board-assets' and public.asset_board_role(name) in ('owner','editor'));
create policy assets_update on storage.objects for update to authenticated
  using (bucket_id = 'board-assets' and public.asset_board_role(name) in ('owner','editor'));
create policy assets_delete on storage.objects for delete to authenticated
  using (bucket_id = 'board-assets' and public.asset_board_role(name) in ('owner','editor'));
