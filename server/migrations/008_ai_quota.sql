-- Repository-only until explicitly authorized for an isolated environment.
-- Independent of private learning data; no existing user rows are changed.
begin;
create table if not exists public.ai_quota_policy (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default true,
  requests_per_minute integer not null default 15 check (requests_per_minute between 1 and 1000),
  user_concurrency integer not null default 1 check (user_concurrency between 1 and 10),
  global_concurrency integer not null default 8 check (global_concurrency between 1 and 100),
  user_daily_units bigint not null default 500000 check (user_daily_units > 0),
  global_daily_units bigint not null default 2000000 check (global_daily_units > 0),
  global_total_units bigint not null default 20000000 check (global_total_units > 0)
);
insert into public.ai_quota_policy(singleton) values(true) on conflict do nothing;
create table if not exists public.ai_quota_counters (
  bucket text not null,
  period bigint not null,
  used bigint not null check (used >= 0),
  primary key(bucket, period)
);
create table if not exists public.ai_quota_requests (
  request_id uuid primary key,
  user_id uuid not null,
  input_hash text not null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  finished boolean not null default false
);
create index if not exists ai_quota_active on public.ai_quota_requests(user_id, expires_at) where not finished;
alter table public.ai_quota_policy enable row level security;
alter table public.ai_quota_counters enable row level security;
alter table public.ai_quota_requests enable row level security;
revoke all on public.ai_quota_policy, public.ai_quota_counters, public.ai_quota_requests from public, anon, authenticated, service_role;

create or replace function public.learnspace_ai_quota(
  p_operation text, p_user uuid, p_request uuid, p_hash text default '', p_units bigint default 0
) returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '2s' as $$
declare
  policy public.ai_quota_policy%rowtype;
  prior public.ai_quota_requests%rowtype;
  now_at timestamptz := clock_timestamp();
  minute_at bigint;
  day_at bigint;
  used_units bigint;
  count_active bigint;
begin
  -- One short global critical section is sufficient for this project's scale.
  -- DB time and a fixed lock survive Vercel instances, cold starts and crashes.
  perform pg_catalog.pg_advisory_xact_lock(718231004::bigint);
  now_at := clock_timestamp();
  minute_at := floor(extract(epoch from now_at) / 60)::bigint;
  day_at := floor(extract(epoch from now_at) / 86400)::bigint;
  if p_user is null or p_request is null or p_operation not in ('begin','reserve','finish') then
    raise exception 'Invalid quota request';
  end if;
  select * into prior from public.ai_quota_requests where request_id = p_request;
  if p_operation = 'finish' then
    update public.ai_quota_requests set finished = true where request_id = p_request and user_id = p_user;
    return jsonb_build_object('allowed', true);
  end if;
  if p_units < 1 or p_units > 2000000 or (p_operation = 'begin' and p_hash !~ '^[a-f0-9]{64}$') then
    raise exception 'Invalid quota reservation';
  end if;
  select * into strict policy from public.ai_quota_policy where singleton;
  if not policy.enabled then return jsonb_build_object('allowed',false,'code','BUDGET'); end if;
  if p_operation = 'begin' then
    if prior.request_id is not null then return jsonb_build_object('allowed',false,'code','DUPLICATE'); end if;
    if exists(select 1 from public.ai_quota_requests where user_id = p_user and input_hash = p_hash and not finished and expires_at > now_at) then
      return jsonb_build_object('allowed',false,'code','DUPLICATE');
    end if;
    select count(*) into count_active from public.ai_quota_requests where not finished and expires_at > now_at;
    if count_active >= policy.global_concurrency or
      (select count(*) from public.ai_quota_requests where user_id = p_user and not finished and expires_at > now_at) >= policy.user_concurrency then
      return jsonb_build_object('allowed',false,'code','CONCURRENCY','retry_after',90);
    end if;
    select coalesce((select used from public.ai_quota_counters where bucket = 'minute:' || p_user::text and period = minute_at),0) into used_units;
    if used_units >= policy.requests_per_minute then
      return jsonb_build_object('allowed',false,'code','RATE_LIMIT','retry_after',60 - mod(floor(extract(epoch from now_at))::bigint,60));
    end if;
  elsif prior.request_id is null or prior.user_id <> p_user or prior.finished or prior.expires_at <= now_at then
    return jsonb_build_object('allowed',false,'code','EXPIRED');
  end if;
  if coalesce((select used from public.ai_quota_counters where bucket = 'user:' || p_user::text and period = day_at),0) + p_units > policy.user_daily_units
    or coalesce((select used from public.ai_quota_counters where bucket = 'global:day' and period = day_at),0) + p_units > policy.global_daily_units
    or coalesce((select used from public.ai_quota_counters where bucket = 'global:total' and period = 0),0) + p_units > policy.global_total_units then
    return jsonb_build_object('allowed',false,'code','BUDGET');
  end if;
  if p_operation = 'begin' then
    insert into public.ai_quota_requests(request_id,user_id,input_hash,expires_at)
      values(p_request,p_user,p_hash,now_at + interval '90 seconds');
    insert into public.ai_quota_counters values('minute:' || p_user::text,minute_at,1)
      on conflict(bucket,period) do update set used = public.ai_quota_counters.used + 1;
  end if;
  insert into public.ai_quota_counters values
    ('user:' || p_user::text,day_at,p_units),('global:day',day_at,p_units),('global:total',0,p_units)
    on conflict(bucket,period) do update set used = public.ai_quota_counters.used + excluded.used;
  -- Bounded retention of metadata; cumulative budget is never reset here.
  delete from public.ai_quota_requests where created_at < now_at - interval '7 days' and expires_at < now_at;
  delete from public.ai_quota_counters where (bucket like 'minute:%' and period < minute_at - 10080)
    or (bucket <> 'global:total' and bucket not like 'minute:%' and period < day_at - 7);
  return jsonb_build_object('allowed', true);
end;
$$;
revoke all on function public.learnspace_ai_quota(text,uuid,uuid,text,bigint) from public, anon, authenticated;
grant execute on function public.learnspace_ai_quota(text,uuid,uuid,text,bigint) to service_role;
commit;
