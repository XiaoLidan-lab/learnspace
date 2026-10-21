-- Replace only the business conflict code; preserve function body, ACL and data.
-- PostgREST 14 can retry SQLSTATE 40001 indefinitely. PT409 returns HTTP 409.
begin;
do $migration$
declare definition text;
begin
 definition := pg_get_functiondef('public.save_learning_workspace(uuid,bigint,jsonb)'::regprocedure);
 if position('errcode=''40001''' in definition) > 0 then
  execute replace(definition, 'errcode=''40001''', 'errcode=''PT409''');
 elsif position('errcode=''PT409''' in definition) = 0 then
  raise exception 'Unexpected save_learning_workspace definition; inspect before patching';
 end if;
end $migration$;
commit;
