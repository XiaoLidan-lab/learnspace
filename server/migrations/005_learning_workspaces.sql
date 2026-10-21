begin;
create table if not exists public.learning_workspaces (
 owner_id uuid not null references auth.users(id) on delete cascade,
 workspace_id uuid not null,
 revision bigint not null default 1 check (revision > 0),
 payload jsonb not null,
 updated_at timestamptz not null default now(),
 primary key(owner_id,workspace_id),
 check (octet_length(payload::text) <= 5242880),
 check (payload->>'version' = '1' and jsonb_typeof(payload->'workspace') = 'object'
   and payload->'workspace'->>'id' = workspace_id::text
   and jsonb_typeof(payload->'notes') = 'array')
);
alter table public.learning_workspaces enable row level security;
revoke all on public.learning_workspaces from anon, authenticated;
grant select on public.learning_workspaces to authenticated;
drop policy if exists "Read own learning spaces" on public.learning_workspaces;
create policy "Read own learning spaces" on public.learning_workspaces for select to authenticated using (owner_id = auth.uid());
create or replace function public.save_learning_workspace(p_workspace_id uuid,p_expected_revision bigint,p_payload jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := auth.uid(); v_revision bigint;
begin
 if v_owner is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_expected_revision < 0 or p_expected_revision is null or p_workspace_id is null or p_payload is null then raise exception 'Invalid request' using errcode='22023'; end if;
 if p_payload->>'version' is distinct from '1'
   or jsonb_typeof(p_payload->'workspace') is distinct from 'object'
   or p_payload->'workspace'->>'id' is distinct from p_workspace_id::text
   or jsonb_typeof(p_payload->'workspace'->'modules') is distinct from 'array'
   or jsonb_typeof(p_payload->'notes') is distinct from 'array'
   or p_payload->'workspace'->>'isolationVersion' is distinct from '1'
   or octet_length(p_payload::text)>5242880
   or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('version','workspace','notes'))
   or exists(select 1 from jsonb_array_elements(p_payload->'notes') n where n->>'workspaceId' is distinct from p_workspace_id::text)
 then raise exception 'Invalid learning payload' using errcode='22023'; end if;
 if p_expected_revision=0 then
   insert into public.learning_workspaces(owner_id,workspace_id,payload) values(v_owner,p_workspace_id,p_payload)
   on conflict do nothing returning revision into v_revision;
 else
   update public.learning_workspaces set payload=p_payload,revision=revision+1,updated_at=now()
   where owner_id=v_owner and workspace_id=p_workspace_id and revision=p_expected_revision returning revision into v_revision;
 end if;
 if v_revision is null then raise exception 'Cloud revision conflict' using errcode='PT409'; end if;
 return v_revision;
end $$;
revoke all on function public.save_learning_workspace(uuid,bigint,jsonb) from public,anon;
grant execute on function public.save_learning_workspace(uuid,bigint,jsonb) to authenticated;
commit;
