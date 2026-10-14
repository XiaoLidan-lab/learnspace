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
 check (template_config->>'version' = '1'),
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
declare m jsonb; n jsonb; l jsonb; r jsonb; k text; value jsonb;
begin
 if jsonb_typeof(new.template_config) is distinct from 'object' or new.template_config->>'version' is distinct from '1' or jsonb_typeof(new.template_config->'modules') is distinct from 'array' or octet_length(new.template_config::text)>102400 then raise exception 'Invalid template'; end if;
 for k in select jsonb_object_keys(new.template_config) loop
  if k not in ('version','title','description','modules') then raise exception 'Unexpected template field'; end if;
 end loop;
 if jsonb_typeof(new.template_config->'title') is distinct from 'string' or char_length(new.template_config->>'title') not between 1 and 80 or jsonb_typeof(new.template_config->'description') is distinct from 'string' or char_length(new.template_config->>'description')>1000 then raise exception 'Invalid template content'; end if;
 for m in select * from jsonb_array_elements(new.template_config->'modules') loop
  if jsonb_typeof(m) is distinct from 'object' then raise exception 'Invalid module'; end if;
  for k in select jsonb_object_keys(m) loop
   if k not in ('type','title','layout','settings','group','locked') then raise exception 'Private or unsupported module data'; end if;
  end loop;
  if jsonb_typeof(m->'type') is distinct from 'string' or m->>'type' not in ('pdf','web','video','text','chat','translate','summary','mindmap','note','cards','todo','quiz','pomodoro','calendar','sticky','image') or jsonb_typeof(m->'title') is distinct from 'string' or char_length(m->>'title') not between 1 and 80 then raise exception 'Invalid module'; end if;
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
