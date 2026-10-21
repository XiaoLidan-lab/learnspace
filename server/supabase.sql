begin;

-- Run in Supabase SQL Editor. Enable email OTP in Authentication.
create table if not exists public.templates (
 id uuid primary key default gen_random_uuid(),
 author_id uuid not null references auth.users(id),
 author_name text not null check (char_length(author_name) <= 100),
 title text not null check (char_length(title) between 1 and 80),
 description text not null default '' check (char_length(description) <= 1000),
 category text not null check (category in ('论文阅读','课程复习','技术学习','通用学习')),
 template_config jsonb not null,
 origin_id uuid references public.templates(id),
 publication_status text not null default 'published' check (publication_status in ('pending','published','rejected')),
 created_at timestamptz not null default now(),
 check (template_config->>'version' in ('1','2')),
 check (jsonb_typeof(template_config->'modules') = 'array'),
 check (jsonb_array_length(template_config->'modules') <= 24)
);
alter table public.templates enable row level security;
drop policy if exists "Read public templates or own submissions" on public.templates;
create policy "Read public templates or own submissions" on public.templates for select using (publication_status = 'published' or auth.uid() = author_id);
drop policy if exists "Submit own template for review" on public.templates;
drop policy if exists "Publish own template" on public.templates;
create policy "Publish own template" on public.templates for insert to authenticated with check (auth.uid() = author_id and publication_status = 'published');
alter table public.templates alter column publication_status set default 'published';
-- Users publish valid templates directly; private content is rejected by the trigger below.
-- Upgrade existing LearnSpace community tables. Run once in Supabase SQL Editor.
-- No private workspace data is uploaded or migrated.
do $$ declare c record; begin
 for c in select conname from pg_constraint where conrelid='public.templates'::regclass and contype='c' and pg_get_constraintdef(oid) like '%jsonb_array_length%' loop
  execute format('alter table public.templates drop constraint %I',c.conname);
 end loop;
end $$;
alter table public.templates add constraint templates_module_limit check (jsonb_array_length(template_config->'modules') <= 24);
create or replace function public.validate_template_privacy() returns trigger language plpgsql as $$
declare m jsonb; n jsonb; l jsonb; r jsonb; k text; value jsonb; cfg jsonb; f jsonb; e jsonb; src jsonb; dst jsonb; v2 boolean; placeholder text;
begin
 v2 := new.template_config->>'version' = '2';
 if jsonb_typeof(new.template_config) is distinct from 'object' or coalesce(new.template_config->>'version','') not in ('1','2') or jsonb_typeof(new.template_config->'modules') is distinct from 'array' or octet_length(new.template_config::text)>102400 then raise exception 'Invalid template'; end if;
 for k in select jsonb_object_keys(new.template_config) loop
  if k not in ('version','title','description','modules','connections') then raise exception 'Unexpected template field'; end if;
 end loop;
 if jsonb_typeof(new.template_config->'title') is distinct from 'string' or char_length(new.template_config->>'title') not between 1 and 80 or jsonb_typeof(new.template_config->'description') is distinct from 'string' or char_length(new.template_config->>'description')>1000 then raise exception 'Invalid template content'; end if;
 for m in select * from jsonb_array_elements(new.template_config->'modules') loop
  if jsonb_typeof(m) is distinct from 'object' then raise exception 'Invalid module'; end if;
  for k in select jsonb_object_keys(m) loop
   if k not in ('type','title','layout','settings','group','locked','instanceId','customConfig') then raise exception 'Private or unsupported module data'; end if;
  end loop;
  if jsonb_typeof(m->'type') is distinct from 'string' or m->>'type' not in ('pdf','web','video','text','chat','translate','summary','mindmap','note','cards','todo','quiz','pomodoro','calendar','sticky','image','custom-ai') or jsonb_typeof(m->'title') is distinct from 'string' or char_length(m->>'title') not between 1 and 80 then raise exception 'Invalid module'; end if;

  if not v2 and (m ? 'customConfig' or m->>'type'='custom-ai') then raise exception 'Custom modules require V2'; end if;
  if v2 and (jsonb_typeof(m->'instanceId') is distinct from 'string' or m->>'instanceId' !~ '^m[1-9][0-9]*$') then raise exception 'Invalid V2 module ID'; end if;
  if m ? 'instanceId' and (jsonb_typeof(m->'instanceId') is distinct from 'string' or char_length(m->>'instanceId') not between 1 and 80) then raise exception 'Invalid instance ID'; end if;
  if v2 and m ? 'group' and m->>'group' !~ '^g[1-9][0-9]*$' then raise exception 'Invalid V2 group'; end if;
  if v2 and ((m->>'type'='custom-ai') <> (m ? 'customConfig')) then raise exception 'Incompatible custom configuration'; end if;
  if m ? 'customConfig' then
   cfg:=m->'customConfig';
   if jsonb_typeof(cfg) is distinct from 'object' or not (cfg ?& array['version','name','purpose','fields','prompt','display']) or exists(select 1 from jsonb_object_keys(cfg) t where t not in ('version','name','purpose','fields','prompt','display')) then raise exception 'Invalid or private custom configuration'; end if;
   if jsonb_typeof(cfg->'version') is distinct from 'number' or (cfg->>'version')::numeric<1 or (cfg->>'version')::numeric<>trunc((cfg->>'version')::numeric) or jsonb_typeof(cfg->'name') is distinct from 'string' or char_length(btrim(cfg->>'name')) not between 1 and 80 or jsonb_typeof(cfg->'purpose') is distinct from 'string' or char_length(btrim(cfg->>'purpose')) not between 1 and 500 or jsonb_typeof(cfg->'prompt') is distinct from 'string' or char_length(btrim(cfg->>'prompt')) not between 1 and 4000 or jsonb_typeof(cfg->'display') is distinct from 'string' or cfg->>'display' not in ('text','markdown') then raise exception 'Invalid AI configuration'; end if;
   if jsonb_typeof(cfg->'fields') is distinct from 'array' then raise exception 'Invalid fields'; end if;
   if jsonb_array_length(cfg->'fields') not between 1 and 8 then raise exception 'Invalid fields'; end if;
   for f in select * from jsonb_array_elements(cfg->'fields') loop
    if jsonb_typeof(f) is distinct from 'object' or not (f ?& array['id','label','required']) or exists(select 1 from jsonb_object_keys(f) t where t not in ('id','label','required')) then raise exception 'Invalid input field'; end if;
    if jsonb_typeof(f->'id') is distinct from 'string' or f->>'id' !~ '^[a-z][a-z0-9_]{0,31}$' or jsonb_typeof(f->'label') is distinct from 'string' or char_length(btrim(f->>'label')) not between 1 and 80 or jsonb_typeof(f->'required') is distinct from 'boolean' then raise exception 'Invalid input field'; end if;
   end loop;
   if exists(select 1 from jsonb_array_elements(cfg->'fields') t group by t->>'id' having count(*)>1) then raise exception 'Duplicate input'; end if;
   for placeholder in select a[1] from regexp_matches(cfg->>'prompt', '\{\{([a-z][a-z0-9_]{0,31})\}\}', 'g') a loop
    if not exists(select 1 from jsonb_array_elements(cfg->'fields') ff where ff->>'id'=placeholder) then raise exception 'Undeclared Prompt variable'; end if;
   end loop;
   if regexp_replace(cfg->>'prompt','\{\{[a-z][a-z0-9_]{0,31}\}\}','', 'g') ~ '[{}]' then raise exception 'Invalid Prompt placeholder'; end if;
  end if;
  if m ? 'group' and (jsonb_typeof(m->'group') is distinct from 'string' or char_length(m->>'group') not between 1 and 80) then raise exception 'Invalid group'; end if;
  if m ? 'locked' and jsonb_typeof(m->'locked') is distinct from 'boolean' then raise exception 'Invalid lock'; end if;
  l:=m->'layout';if jsonb_typeof(l) is distinct from 'object' or not (l ?& array['x','y','w','h']) then raise exception 'Missing layout'; end if;
  for k in select jsonb_object_keys(l) loop
   if k not in ('x','y','w','h') or jsonb_typeof(l->k) is distinct from 'number' or (l->>k)::numeric <> trunc((l->>k)::numeric) then raise exception 'Invalid layout'; end if;
  end loop;
  if (l->>'x')::numeric<0 or (l->>'y')::numeric<0 or (l->>'y')::numeric>100 or (l->>'w')::numeric<3 or (l->>'h')::numeric<3 or (l->>'h')::numeric>20 or (l->>'x')::numeric+(l->>'w')::numeric>12 then raise exception 'Invalid layout bounds'; end if;
  if m ? 'settings' then
   if jsonb_typeof(m->'settings') is distinct from 'object' then raise exception 'Invalid settings'; end if;
   for k,value in select * from jsonb_each(m->'settings') loop
    if k in ('focusMinutes','breakMinutes') then
     if jsonb_typeof(value) is distinct from 'number' or (value::text)::numeric<>trunc((value::text)::numeric) or (value::text)::numeric<1 or (value::text)::numeric > (case when k='focusMinutes' then 120 else 60 end) then raise exception 'Invalid timer'; end if;
    elsif k='language' then
     if value#>>'{}' not in ('简体中文','English','日本語','한국어','Français') then raise exception 'Invalid language'; end if;
    elsif k='sourceLanguage' then
     if value#>>'{}' not in ('自动检测','简体中文','English','日本語','한국어','Français') then raise exception 'Invalid source language'; end if;
    elsif k='summaryStyle' then
     if value#>>'{}' not in ('brief','detailed','bullets') then raise exception 'Invalid summary style'; end if;
    elsif k='fit' then
     if value#>>'{}' not in ('contain','cover') then raise exception 'Invalid image fit'; end if;
    elsif k='format' then
     if value#>>'{}' not in ('plain','markdown') then raise exception 'Invalid text format'; end if;
    else raise exception 'Private or unsupported settings'; end if;
    if k not in ('focusMinutes','breakMinutes') and jsonb_typeof(value) is distinct from 'string' then raise exception 'Invalid setting type'; end if;
   end loop;
  end if;
  for n in select * from jsonb_array_elements(new.template_config->'modules') loop
   if n=m then continue; end if; r:=n->'layout';
   if m ? 'group' and n->>'group'=m->>'group' then
    if l<>r then raise exception 'Grouped modules require identical layouts'; end if;
   elsif (l->>'x')::numeric<(r->>'x')::numeric+(r->>'w')::numeric and (l->>'x')::numeric+(l->>'w')::numeric>(r->>'x')::numeric and (l->>'y')::numeric<(r->>'y')::numeric+(r->>'h')::numeric and (l->>'y')::numeric+(l->>'h')::numeric>(r->>'y')::numeric then raise exception 'Modules overlap'; end if;
  end loop;
 end loop;
 -- Reject duplicate ungrouped modules with identical layouts.
 if exists(select 1 from jsonb_array_elements(new.template_config->'modules') as item(v) group by v having count(*)>1 and not (v ? 'group')) then raise exception 'Duplicate overlapping modules'; end if;

 if not v2 and new.template_config ? 'connections' then raise exception 'Connections require V2'; end if;
 if v2 then
  if new.template_config::text ~ '(sk-[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9_-]{16,}|Bearer[[:space:]]+[A-Za-z0-9_.-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,})' then raise exception 'Template appears to contain credentials'; end if;
  if coalesce(new.shared_materials,'[]'::jsonb) <> '[]'::jsonb then raise exception 'V2 templates cannot include private materials'; end if;
  if jsonb_typeof(new.template_config->'connections') is distinct from 'array' then raise exception 'Missing connections'; end if;
  if jsonb_array_length(new.template_config->'connections')>48 then raise exception 'Too many connections'; end if;
  if exists(select 1 from jsonb_array_elements(new.template_config->'modules') t group by t->>'instanceId' having count(*)>1) then raise exception 'Duplicate module ID'; end if;
  for e in select * from jsonb_array_elements(new.template_config->'connections') loop
   if jsonb_typeof(e) is distinct from 'object' or not (e ?& array['id','source','target','trigger','mode']) or exists(select 1 from jsonb_object_keys(e) t where t not in ('id','source','target','trigger','mode')) then raise exception 'Invalid connection'; end if;
   if jsonb_typeof(e->'id') is distinct from 'string' or e->>'id' !~ '^c[1-9][0-9]*$' or e->>'trigger' is distinct from 'manual' or e->>'mode' is distinct from 'replace' then raise exception 'Invalid connection mode'; end if;
   if jsonb_typeof(e->'source') is distinct from 'object' or jsonb_typeof(e->'target') is distinct from 'object' then raise exception 'Invalid endpoints'; end if;
   if not (e->'source' ?& array['moduleId','port']) or not (e->'target' ?& array['moduleId','field']) or exists(select 1 from jsonb_object_keys(e->'source') t where t not in ('moduleId','port','needsBinding','range')) or exists(select 1 from jsonb_object_keys(e->'target') t where t not in ('moduleId','field')) then raise exception 'Private or invalid binding'; end if;
   if jsonb_typeof(e->'source'->'moduleId') is distinct from 'string' or jsonb_typeof(e->'source'->'port') is distinct from 'string' or jsonb_typeof(e->'target'->'moduleId') is distinct from 'string' or jsonb_typeof(e->'target'->'field') is distinct from 'string' then raise exception 'Invalid endpoint types'; end if;
   if e->'source' ? 'range' and (jsonb_typeof(e->'source'->'range') is distinct from 'string' or e->'source'->>'range' not in ('selection','document') or e->'source'->>'port' is distinct from 'selection' or not exists(select 1 from jsonb_array_elements(new.template_config->'modules') t where t->>'instanceId'=e->'source'->>'moduleId' and t->>'type'='pdf')) then raise exception 'Invalid data range'; end if;
   select t into src from jsonb_array_elements(new.template_config->'modules') t where t->>'instanceId'=e->'source'->>'moduleId';
   select t into dst from jsonb_array_elements(new.template_config->'modules') t where t->>'instanceId'=e->'target'->>'moduleId';
   if src is null or dst is null or src=dst or dst->>'type'<>'custom-ai' or not exists(select 1 from jsonb_array_elements(dst->'customConfig'->'fields') ff where ff->>'id'=e->'target'->>'field') then raise exception 'Invalid connection endpoints'; end if;
   if not ((src->>'type'='pdf' and e->'source'->>'port' in ('selection','retrieval')) or (src->>'type' in ('text','sticky') and e->'source'->>'port' in ('text','selection')) or (src->>'type'='note' and e->'source'->>'port'='note') or (src->>'type' in ('summary','translate','custom-ai') and e->'source'->>'port'='output')) then raise exception 'Incompatible output'; end if;
   if src->>'type'='pdf' or e->'source'->>'port' in ('selection','note') then
    if e->'source'->'needsBinding' is distinct from 'true'::jsonb then raise exception 'Private source requires rebinding'; end if;
   elsif e->'source' ? 'needsBinding' then raise exception 'Invalid rebinding flag'; end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(new.template_config->'connections') t group by t->>'id' having count(*)>1) or exists(select 1 from jsonb_array_elements(new.template_config->'connections') t group by t->'target'->>'moduleId',t->'target'->>'field' having count(*)>1) then raise exception 'Duplicate connection or target'; end if;
  if exists(with recursive edges as (select t->'source'->>'moduleId' a,t->'target'->>'moduleId' b from jsonb_array_elements(new.template_config->'connections') t), walk(a,b,path,cycle) as (select a,b,array[a,b],a=b from edges union all select w.a,e.b,w.path||e.b,e.b=any(w.path) from walk w join edges e on e.a=w.b where not w.cycle and cardinality(w.path)<=49) select 1 from walk where cycle) then raise exception 'Connection cycle'; end if;
 end if;
 return new;
end $$;


drop trigger if exists template_privacy on public.templates;
create trigger template_privacy before insert or update on public.templates for each row execute function public.validate_template_privacy();

update public.templates set publication_status = 'published' where publication_status = 'pending';
-- Opt-in community materials. Template structure remains private-data-free.
alter table public.templates add column if not exists shared_materials jsonb not null default '[]'::jsonb;
create or replace function public.validate_shared_materials() returns trigger language plpgsql as $$
declare m jsonb; k text; kind text; idx numeric; module_type text; total_size numeric:=0;
begin
 if jsonb_typeof(new.shared_materials) is distinct from 'array' or jsonb_array_length(new.shared_materials)>72 or octet_length(new.shared_materials::text)>524288 then raise exception 'Invalid shared materials'; end if;
 for m in select * from jsonb_array_elements(new.shared_materials) loop
  if jsonb_typeof(m) is distinct from 'object' or jsonb_typeof(m->'moduleIndex') is distinct from 'number' or jsonb_typeof(m->'name') is distinct from 'string' or char_length(m->>'name') not between 1 and 200 or jsonb_typeof(m->'kind') is distinct from 'string' then raise exception 'Invalid shared material'; end if;
  idx:=(m->>'moduleIndex')::numeric;
  if idx<>trunc(idx) or idx<0 or idx>=jsonb_array_length(new.template_config->'modules') then raise exception 'Invalid material binding'; end if;
  module_type:=new.template_config->'modules'->(idx::int)->>'type';kind:=m->>'kind';
  for k in select jsonb_object_keys(m) loop
   if k not in ('moduleIndex','name','kind') and not (kind='file' and k in ('path','mime','size')) and not (kind='url' and k='url') and not (kind in ('text','transcript','note') and k='text') and not (kind='note' and k='noteIndex') then raise exception 'Unsupported shared material field'; end if;
  end loop;
  if kind='file' then
   if module_type not in ('pdf','image','video') or jsonb_typeof(m->'path') is distinct from 'string' or jsonb_typeof(m->'mime') is distinct from 'string' or jsonb_typeof(m->'size') is distinct from 'number' then raise exception 'Invalid shared file'; end if;
   if m->>'path' !~ ('^'||new.author_id::text||'/'||new.id::text||'/[0-9a-f-]{36}$') then raise exception 'Invalid shared file ownership'; end if;
   if (m->>'size')::numeric<>trunc((m->>'size')::numeric) or (m->>'size')::numeric not between 1 and 52428800 then raise exception 'Invalid shared file size'; end if;
   if (module_type='pdf' and m->>'mime'<>'application/pdf') or (module_type='image' and m->>'mime' not in ('image/png','image/jpeg','image/webp','image/gif','image/avif')) or (module_type='video' and m->>'mime' not in ('video/mp4','video/webm','video/quicktime','video/ogg')) then raise exception 'Invalid shared file type'; end if;
   if not exists(select 1 from storage.objects o where o.bucket_id='learnspace-materials' and o.name=m->>'path' and (o.metadata->>'size')::numeric=(m->>'size')::numeric and o.metadata->>'mimetype'=m->>'mime') then raise exception 'Shared file missing or metadata mismatch'; end if;
   total_size:=total_size+(m->>'size')::numeric;
  elsif kind='url' then
   if module_type not in ('web','video') or jsonb_typeof(m->'url') is distinct from 'string' or char_length(m->>'url')>4000 or m->>'url' !~ '^https?://[^/@[:space:]]+([/?#]|$)' then raise exception 'Invalid shared URL'; end if;
  elsif kind in ('text','transcript','note') then
   if (kind='text' and module_type not in ('text','web')) or (kind='transcript' and module_type<>'video') or (kind='note' and module_type<>'note') or jsonb_typeof(m->'text') is distinct from 'string' or char_length(m->>'text') not between 1 and 50000 then raise exception 'Invalid shared text'; end if;
   if kind='note' and (jsonb_typeof(m->'noteIndex') is distinct from 'number' or (m->>'noteIndex')::numeric<>trunc((m->>'noteIndex')::numeric) or (m->>'noteIndex')::numeric not between 0 and 99) then raise exception 'Invalid shared note'; end if;
  else raise exception 'Unsupported material kind'; end if;
 end loop;
 if total_size>104857600 then raise exception 'Shared files exceed total limit'; end if;
 if exists(select 1 from jsonb_array_elements(new.shared_materials) as item(v) group by v->>'moduleIndex',v->>'kind',case when v->>'kind'='note' then v->>'noteIndex' else '' end having count(*)>1) then raise exception 'Duplicate shared material'; end if;
 return new;
end $$;
drop trigger if exists shared_material_privacy on public.templates;
create trigger shared_material_privacy before insert or update on public.templates for each row execute function public.validate_shared_materials();
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values ('learnspace-materials','learnspace-materials',false,52428800,array['application/pdf','image/png','image/jpeg','image/webp','image/gif','image/avif','video/mp4','video/webm','video/quicktime','video/ogg']) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists "Upload own LearnSpace materials" on storage.objects;
create policy "Upload own LearnSpace materials" on storage.objects for insert to authenticated with check (bucket_id='learnspace-materials' and split_part(name,'/',1)=auth.uid()::text and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}$');
drop policy if exists "Read published LearnSpace materials" on storage.objects;
create policy "Read published LearnSpace materials" on storage.objects for select using (bucket_id='learnspace-materials' and (split_part(name,'/',1)=auth.uid()::text or exists(select 1 from public.templates t cross join lateral jsonb_array_elements(t.shared_materials) as item(v) where t.publication_status='published' and v->>'kind'='file' and v->>'path'=storage.objects.name)));
drop policy if exists "Remove unattached LearnSpace uploads" on storage.objects;
create policy "Remove unattached LearnSpace uploads" on storage.objects for delete to authenticated using (bucket_id='learnspace-materials' and split_part(name,'/',1)=auth.uid()::text and not exists(select 1 from public.templates t cross join lateral jsonb_array_elements(t.shared_materials) as item(v) where v->>'path'=storage.objects.name));
commit;

-- Private learning workspaces (005)
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
