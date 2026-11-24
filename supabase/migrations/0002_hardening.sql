-- White Canvas — launch hardening (audit findings)

-- ---------- paging index: ordered scan inside one board ----------
create index if not exists board_items_board_id_id_idx on public.board_items (board_id, id) where not deleted;
drop index if exists public.board_items_board_idx;

-- ---------- revisions: wide enough that they can never overflow ----------
alter table public.board_items alter column rev type bigint;

-- ---------- size and shape limits ----------
alter table public.board_items add constraint board_items_data_shape
  check (jsonb_typeof(data) = 'object' and jsonb_typeof(data->'type') = 'string');
alter table public.board_items add constraint board_items_data_size
  check (octet_length(data::text) <= 1048576);
alter table public.boards add constraint boards_title_len check (char_length(title) between 1 and 200);
alter table public.boards add constraint boards_thumbnail_len check (thumbnail is null or char_length(thumbnail) <= 262144);
alter table public.boards add constraint boards_settings_size check (octet_length(settings::text) <= 16384);
alter table public.profiles add constraint profiles_name_len check (char_length(display_name) <= 80);
alter table public.profiles add constraint profiles_color_fmt check (color ~ '^#[0-9a-fA-F]{6}$');
alter table public.profiles add constraint profiles_settings_size check (octet_length(settings::text) <= 16384);
alter table public.board_versions add constraint board_versions_name_len check (char_length(name) <= 200);
alter table public.board_versions add constraint board_versions_snapshot_shape check (jsonb_typeof(snapshot) = 'array');
alter table public.api_tokens add constraint api_tokens_name_len check (char_length(name) <= 80);

-- ---------- agent tokens expire ----------
alter table public.api_tokens add column if not exists expires_at timestamptz;

-- ---------- item writes: server-arbitrated revisions, comment integrity ----------
create or replace function public.board_items_touch() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  role text;
  author text;
  old_len int;
  new_len int;
  i int;
  entry jsonb;
  thread jsonb;
begin
  new.updated_at := now();
  if uid is not null then new.updated_by := uid; end if;

  if tg_op = 'UPDATE' then
    -- items never move between boards, and the server decides the final revision
    new.board_id := old.board_id;
    new.rev := greatest(old.rev + 1, least(new.rev, old.rev + 1000));
  else
    new.rev := least(greatest(coalesce(new.rev, 1), 1), 1000);
  end if;
  new.data := new.data || jsonb_build_object('id', new.id::text, 'rev', new.rev);

  -- signed-in writers (not the agent server) get comment authorship enforced
  if uid is not null and new.data->>'type' = 'comment' then
    select display_name into author from public.profiles where id = uid;
    thread := coalesce(new.data->'thread', '[]'::jsonb);
    if jsonb_typeof(thread) <> 'array' then raise exception 'comment thread must be a list'; end if;
    new_len := jsonb_array_length(thread);
    old_len := case when tg_op = 'UPDATE' and old.data->>'type' = 'comment' and jsonb_typeof(old.data->'thread') = 'array'
                    then jsonb_array_length(old.data->'thread') else 0 end;
    role := public.board_role(new.board_id);

    if role = 'commenter' then
      if tg_op = 'UPDATE' then
        if old.data->>'type' <> 'comment' then raise exception 'not allowed'; end if;
        -- commenters may add replies and resolve; they may not rewrite history or other fields
        if new_len < old_len then raise exception 'comments cannot be removed by commenters'; end if;
        for i in 0 .. old_len - 1 loop
          if thread->i is distinct from old.data->'thread'->i then raise exception 'existing comments cannot be edited'; end if;
        end loop;
        if (new.data - 'thread' - 'resolved' - 'rev') is distinct from (old.data - 'thread' - 'resolved' - 'rev') then
          raise exception 'commenters can only reply or resolve';
        end if;
        if new.deleted and not old.deleted and old.data->>'by' is distinct from uid::text then
          raise exception 'only the author can delete a comment thread';
        end if;
      else
        new.data := new.data || jsonb_build_object('by', uid::text);
      end if;
    end if;

    -- new entries always carry the real author
    for i in old_len .. new_len - 1 loop
      entry := thread->i;
      if jsonb_typeof(entry) <> 'object' then raise exception 'invalid comment'; end if;
      thread := jsonb_set(thread, array[i::text], entry || jsonb_build_object('by', uid::text, 'name', coalesce(nullif(author, ''), 'Member'), 'text', left(coalesce(entry->>'text', ''), 4000)));
    end loop;
    if new_len > 500 then raise exception 'comment thread is full'; end if;
    new.data := jsonb_set(new.data, '{thread}', thread);
  end if;

  update public.boards set updated_at = now()
    where id = new.board_id and updated_at < now() - interval '20 seconds';
  return new;
end $$;
revoke execute on function public.board_items_touch() from public, anon, authenticated;

-- ---------- per-board item cap (one check per statement) ----------
create or replace function public.board_items_cap() returns trigger
language plpgsql security definer set search_path = '' as $$
declare b uuid;
begin
  for b in select distinct board_id from fresh loop
    if (select count(*) from (select 1 from public.board_items where board_id = b and not deleted limit 50001) t) > 50000 then
      raise exception 'This board has reached the 50,000 item limit';
    end if;
  end loop;
  return null;
end $$;
revoke execute on function public.board_items_cap() from public, anon, authenticated;
drop trigger if exists board_items_cap on public.board_items;
create trigger board_items_cap after insert on public.board_items
  referencing new table as fresh for each statement execute function public.board_items_cap();

-- ---------- version history: keep automatic snapshots bounded ----------
create or replace function public.board_versions_prune() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.board_versions v
  where v.board_id = new.board_id and v.auto
    and v.id not in (select id from public.board_versions where board_id = new.board_id and auto order by created_at desc limit 30);
  delete from public.board_versions v
  where v.board_id = new.board_id and not v.auto
    and v.id not in (select id from public.board_versions where board_id = new.board_id and not auto order by created_at desc limit 200);
  return null;
end $$;
revoke execute on function public.board_versions_prune() from public, anon, authenticated;
drop trigger if exists board_versions_prune on public.board_versions;
create trigger board_versions_prune after insert on public.board_versions
  for each row execute function public.board_versions_prune();

-- ---------- membership: nobody can be added to a board without opening its link ----------
drop policy if exists members_insert on public.board_members;

-- ---------- profiles: visible to yourself and to people you share a board with ----------
create or replace function public.shares_board_with(other uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from (
      select id as board_id from public.boards where owner_id = (select auth.uid())
      union
      select board_id from public.board_members where user_id = (select auth.uid())
    ) mine
    where exists (select 1 from public.boards b where b.id = mine.board_id and b.owner_id = other)
       or exists (select 1 from public.board_members m where m.board_id = mine.board_id and m.user_id = other)
  )
$$;
revoke execute on function public.shares_board_with(uuid) from public, anon;
grant execute on function public.shares_board_with(uuid) to authenticated;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.shares_board_with(id));

-- ---------- realtime: only editors may steer other people's views ----------
-- ("summon" now travels on the ops:<board> topic, which viewers cannot write to)
