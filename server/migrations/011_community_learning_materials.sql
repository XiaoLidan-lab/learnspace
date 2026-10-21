-- Requires 004 shared-material validation and 007 V2 configuration validation.
-- Repository implementation only: apply to Supabase only after explicit approval.
-- Replaces the configuration trigger function; no user rows, RLS, ACL or Storage
-- policies change. Opt-in materials still pass the independent 004 validator.
begin;
do $$ begin
 if not exists(select 1 from pg_trigger where tgrelid='public.templates'::regclass and tgname='shared_material_privacy' and tgenabled='O' and tgfoid='public.validate_shared_materials()'::regprocedure) then
  raise exception 'Apply 004_shared_materials.sql before 011';
 end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.templates'::regclass and tgname='template_privacy' and tgenabled='O' and tgfoid='public.validate_template_privacy()'::regprocedure) then
  raise exception 'Apply 007_combination_templates.sql before 011';
 end if;
end $$;
create or replace function public.validate_template_privacy() returns trigger language plpgsql as $$
declare m jsonb; n jsonb; l jsonb; r jsonb; k text; value jsonb; cfg jsonb; f jsonb; e jsonb; src jsonb; dst jsonb; v2 boolean; placeholder text; src_type text; dst_type text; port text; field text; accepted text[]; multiple boolean; private_source boolean;
begin
 v2 := new.template_config->>'version' = '2';
 if jsonb_typeof(new.template_config) is distinct from 'object' or coalesce(new.template_config->>'version','') not in ('1','2') or jsonb_typeof(new.template_config->'modules') is distinct from 'array' or octet_length(new.template_config::text)>102400 then raise exception 'Invalid template'; end if;
 for k in select jsonb_object_keys(new.template_config) loop
  if k not in ('version','title','description','modules','connections') then raise exception 'Unexpected template field'; end if;
 end loop;
 if jsonb_typeof(new.template_config->'title') is distinct from 'string' or char_length(new.template_config->>'title') not between 1 and 80 or jsonb_typeof(new.template_config->'description') is distinct from 'string' or char_length(new.template_config->>'description')>1000 then raise exception 'Invalid template content'; end if;
 if jsonb_array_length(new.template_config->'modules')>24 then raise exception 'Too many modules'; end if;
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
   if src is null or dst is null or src=dst then raise exception 'Invalid connection endpoints'; end if;
   src_type:=src->>'type'; dst_type:=dst->>'type'; port:=e->'source'->>'port'; field:=e->'target'->>'field';
   -- Output/input compatibility mirrors connectionGraph.ts; configuration only.
   if not (port = any(case
    when src_type='pdf' then array['selection','retrieval','document']
    when src_type in ('text','sticky') then array['text','selection']
    when src_type='web' then array['text','web_url']
    when src_type='video' then array['transcript','video_ref']
    when src_type='image' then array['text','image_ref']
    when src_type='note' then array['note']
    when src_type='chat' then array['answer']
    when src_type in ('summary','translate','custom-ai') then array['output']
    when src_type='mindmap' then array['outline']
    when src_type='cards' then array['cards']
    when src_type='todo' then array['tasks']
    when src_type='quiz' then array['questions','results']
    when src_type='calendar' then array['events']
    when src_type='pomodoro' then array['timer'] else array[]::text[] end)) then raise exception 'Incompatible output'; end if;
   accepted:=array['text','selection','output','note','retrieval','answer','transcript','outline','cards','tasks','questions','results','events','timer'];
   multiple:=true;
   if dst_type='custom-ai' then
    if not exists(select 1 from jsonb_array_elements(dst->'customConfig'->'fields') ff where ff->>'id'=field) then raise exception 'Invalid connection input'; end if;
    multiple:=false;
   elsif (dst_type='chat' and field='context') or (dst_type in ('translate','summary','quiz','cards','mindmap') and field='input') or (dst_type in ('text','sticky','note') and field='append') or (dst_type='todo' and field='items') or (dst_type='video' and field='transcript') or (dst_type='image' and field='caption') then
    null;
   elsif dst_type='cards' and field='import' then accepted:=array['cards'];
   elsif dst_type='mindmap' and field='import' then accepted:=array['outline'];
   elsif dst_type='calendar' and field='schedule' then accepted:=array['tasks','events','text','note'];
   elsif dst_type='pomodoro' and field='focus' then accepted:=array['text','selection','note','tasks'];multiple:=false;
   elsif dst_type='pdf' and field='file' then accepted:=array['document'];multiple:=false;
   elsif dst_type='web' and field='url' then accepted:=array['web_url'];multiple:=false;
   elsif dst_type='video' and field='file' then accepted:=array['video_ref'];multiple:=false;
   elsif dst_type='image' and field='file' then accepted:=array['image_ref'];multiple:=false;
   else raise exception 'Invalid connection input'; end if;
   if not (port=any(accepted)) then raise exception 'Incompatible input'; end if;
   if not multiple and (select count(*) from jsonb_array_elements(new.template_config->'connections') x where x->'target'->>'moduleId'=e->'target'->>'moduleId' and x->'target'->>'field'=field)>1 then raise exception 'Duplicate single input'; end if;
   if (select count(*) from jsonb_array_elements(new.template_config->'connections') x where x->'target'->>'moduleId'=e->'target'->>'moduleId')>12 then raise exception 'Too many material sources'; end if;
   private_source:=src_type='pdf' or port in ('note','selection','document','web_url','video_ref','image_ref','tasks','cards','events');
   if private_source then
    if e->'source'->'needsBinding' is distinct from 'true'::jsonb then raise exception 'Private source requires rebinding'; end if;
   elsif e->'source' ? 'needsBinding' then raise exception 'Invalid rebinding flag'; end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(new.template_config->'connections') t group by t->>'id' having count(*)>1) or exists(select 1 from jsonb_array_elements(new.template_config->'connections') t group by t->'source'->>'moduleId',t->'source'->>'port',t->'target'->>'moduleId',t->'target'->>'field' having count(*)>1) then raise exception 'Duplicate connection or target'; end if;
  if exists(with recursive edges as (select t->'source'->>'moduleId' a,t->'target'->>'moduleId' b from jsonb_array_elements(new.template_config->'connections') t), walk(a,b,path,cycle) as (select a,b,array[a,b],a=b from edges union all select w.a,e.b,w.path||e.b,e.b=any(w.path) from walk w join edges e on e.a=w.b where not w.cycle and cardinality(w.path)<=49) select 1 from walk where cycle) then raise exception 'Connection cycle'; end if;
 end if;
 return new;
end $$;

commit;
