-- Move as funções auxiliares para um schema que não é exposto pela API
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

do $$ declare f record; def text; begin
  -- 1) move helpers
  for f in select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname in ('_resolve','_require','_ident_ok','_col_list','ws_role','is_ws_member','is_ws_dev','project_ws') loop
    execute format('alter function %s set schema private', f.sig);
  end loop;
  -- 2) rewrite bodies that reference the helpers
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f' loop
    def := pg_get_functiondef(f.oid);
    if def ~ 'public\.(_resolve|_require|_ident_ok|_col_list|ws_role|is_ws_member|is_ws_dev|project_ws)\(' then
      def := regexp_replace(def, 'public\.(_resolve|_require|_ident_ok|_col_list|ws_role|is_ws_member|is_ws_dev|project_ws)\(', 'private.\1(', 'g');
      execute def;
    end if;
  end loop;
end $$;
