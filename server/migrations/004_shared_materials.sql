begin;
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
