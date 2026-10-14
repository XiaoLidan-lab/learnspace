begin;

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

-- Also repair installations whose previous script failed before creating the trigger.
drop trigger if exists template_privacy on public.templates;
create trigger template_privacy before insert or update on public.templates for each row execute function public.validate_template_privacy();

commit;
