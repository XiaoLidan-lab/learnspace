begin;
-- V2 contains configuration only. Existing V1 rows and permissions are preserved.
do $$ declare c record; begin
 for c in select conname from pg_constraint where conrelid='public.templates'::regclass and contype='c' and pg_get_constraintdef(oid) like '%template_config%' and pg_get_constraintdef(oid) like '%version%' loop
  execute format('alter table public.templates drop constraint %I',c.conname);
 end loop;
end $$;
alter table public.templates add constraint templates_supported_version check (template_config->>'version' in ('1','2'));
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
commit;
