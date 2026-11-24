-- Shared request counters for the server functions (function instances do not share memory).
create table if not exists public.rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  count integer not null default 0
);
alter table public.rate_limits enable row level security;
-- no policies: only the server functions (service role) touch this table

create or replace function public.rate_limit_hit(k text, max_hits integer, window_seconds integer) returns boolean
language plpgsql security definer set search_path = '' as $$
declare c integer;
begin
  insert into public.rate_limits as r (key, window_start, count) values (k, now(), 1)
  on conflict (key) do update set
    count = case when r.window_start < now() - make_interval(secs => window_seconds) then 1 else r.count + 1 end,
    window_start = case when r.window_start < now() - make_interval(secs => window_seconds) then now() else r.window_start end
  returning count into c;
  return c <= max_hits;
end $$;
revoke execute on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;
