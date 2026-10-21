-- Requires 008_ai_quota.sql. Change only the per-user concurrency policy.
-- No counters, active leases, budgets, user content or permissions are changed.
begin;
update public.ai_quota_policy
set user_concurrency = 3
where singleton = true;
commit;
-- To roll back this setting: set user_concurrency = 1 on the same policy row.
