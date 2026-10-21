-- Owner-authorized policy adjustment: no additional personal daily restriction.
-- The existing global daily budget remains the effective shared ceiling.
-- No schema, permissions, counters, request leases or learning data are changed.
begin;
update public.ai_quota_policy
set user_daily_units = global_daily_units
where singleton = true;
commit;
-- Keep user_daily_units >= global_daily_units if raising the global budget later.
