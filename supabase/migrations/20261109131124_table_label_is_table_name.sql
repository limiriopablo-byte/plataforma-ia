-- Tabelas criadas por importação/webhook ganham o próprio nome como rótulo (não o nome da automação)
do $$ declare def text; begin
  def := pg_get_functiondef('public.svc_write_rows(uuid,text,text,jsonb,jsonb,text)'::regprocedure);
  def := replace(def, 'values (p, p_table, coalesce(nullif(p_label,''''), p_table), ''[]'')', 'values (p, p_table, p_table, ''[]'')');
  execute def;
  def := pg_get_functiondef('public.create_webhook(uuid,text,text)'::regprocedure);
  def := replace(def, 'values (p, p_target, p_name, ''[]'')', 'values (p, p_target, p_target, ''[]'')');
  execute def;
end $$;
update public.project_tables pt set label = pt.name
  where exists (select 1 from public.automations a where a.project_id = pt.project_id and a.target_table = pt.name);
select pg_get_functiondef('public.svc_write_rows(uuid,text,text,jsonb,jsonb,text)'::regprocedure) ~ 'values \(p, p_table, p_table' as svc_ok,
       pg_get_functiondef('public.create_webhook(uuid,text,text)'::regprocedure) ~ 'p_target, p_target' as hook_ok;
