-- ===== Membros e convites =====
create table public.workspace_invites (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null,
  role text not null check (role in ('owner','dev','business')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, email)
);
alter table public.workspace_invites enable row level security;
create policy inv_select on public.workspace_invites for select to authenticated using (private.is_ws_member(workspace_id));

create or replace function public.list_members(p_workspace uuid)
returns table(user_id uuid, email text, role text, pending boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private._require(private.is_ws_member(p_workspace), 'Sem acesso a este workspace');
  return query
    select m.user_id, u.email::text, m.role, false from public.workspace_members m join auth.users u on u.id = m.user_id where m.workspace_id = p_workspace
    union all
    select null::uuid, i.email, i.role, true from public.workspace_invites i where i.workspace_id = p_workspace
    order by 4, 2;
end $$;

create or replace function public.invite_member(p_workspace uuid, p_email text, p_role text default 'dev') returns text
language plpgsql security definer set search_path = '' as $$
declare uid uuid; em text := lower(trim(p_email));
begin
  perform private._require(private.ws_role(p_workspace) = 'owner', 'Só o dono do workspace pode convidar');
  perform private._require(p_role in ('owner','dev','business'), 'Papel inválido');
  perform private._require(em ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$', 'E-mail inválido');
  select id into uid from auth.users where lower(email) = em;
  if uid is not null then
    insert into public.workspace_members(workspace_id, user_id, role) values (p_workspace, uid, p_role)
      on conflict (workspace_id, user_id) do update set role = excluded.role;
    return 'added';
  end if;
  insert into public.workspace_invites(workspace_id, email, role, invited_by) values (p_workspace, em, p_role, auth.uid())
    on conflict (workspace_id, email) do update set role = excluded.role;
  return 'invited';
end $$;

create or replace function public.set_member_role(p_workspace uuid, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private._require(private.ws_role(p_workspace) = 'owner', 'Só o dono do workspace pode alterar papéis');
  perform private._require(p_role in ('owner','dev','business'), 'Papel inválido');
  if p_role <> 'owner' then
    perform private._require((select count(*) from public.workspace_members where workspace_id = p_workspace and role = 'owner' and user_id <> p_user) > 0,
      'O workspace precisa de pelo menos um dono');
  end if;
  update public.workspace_members set role = p_role where workspace_id = p_workspace and user_id = p_user;
end $$;

create or replace function public.remove_member(p_workspace uuid, p_user uuid default null, p_email text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private._require(private.ws_role(p_workspace) = 'owner' or p_user = auth.uid(), 'Só o dono do workspace pode remover membros');
  if p_user is not null then
    perform private._require((select count(*) from public.workspace_members where workspace_id = p_workspace and role = 'owner' and user_id <> p_user) > 0,
      'O workspace precisa de pelo menos um dono');
    delete from public.workspace_members where workspace_id = p_workspace and user_id = p_user;
  else
    delete from public.workspace_invites where workspace_id = p_workspace and email = lower(trim(p_email));
  end if;
end $$;

-- Ao criar conta, aceita convites pendentes automaticamente
create or replace function private.accept_invites() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.workspace_members(workspace_id, user_id, role)
    select workspace_id, new.id, role from public.workspace_invites where email = lower(new.email)
    on conflict do nothing;
  delete from public.workspace_invites where email = lower(new.email);
  return new;
end $$;
create trigger on_auth_user_created_accept_invites after insert on auth.users
  for each row execute function private.accept_invites();

-- ===== Colunas =====
create or replace function private._sqltype(t text) returns text
language sql immutable set search_path = '' as $$
  select case t when 'text' then 'text' when 'integer' then 'bigint' when 'numeric' then 'numeric'
    when 'boolean' then 'boolean' when 'date' then 'date' when 'timestamp' then 'timestamptz' end
$$;

create or replace function public.add_column(p uuid, p_table text, p_column jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare r record; nm text := p_column->>'name'; typ text := private._sqltype(p_column->>'type');
begin
  select * into r from private._resolve(p, p_table, true);
  perform private._require(private._ident_ok(nm), 'Nome de coluna inválido');
  perform private._require(typ is not null, 'Tipo inválido');
  perform private._require(not exists(select 1 from jsonb_array_elements(r.cols) c where c->>'name' = nm), 'Já existe uma coluna com esse nome');
  execute format('alter table %I.%I add column %I %s', r.schema_name, p_table, nm, typ);
  update public.project_tables set columns = columns || jsonb_build_array(jsonb_build_object('name', nm, 'type', p_column->>'type', 'label', coalesce(nullif(p_column->>'label',''), nm)))
    where project_id = p and name = p_table;
end $$;

create or replace function public.drop_column(p uuid, p_table text, p_column text) returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  select * into r from private._resolve(p, p_table, true);
  perform private._require(exists(select 1 from jsonb_array_elements(r.cols) c where c->>'name' = p_column), 'Coluna não encontrada');
  perform private._require(jsonb_array_length(r.cols) > 1, 'A tabela precisa ter ao menos uma coluna');
  execute format('alter table %I.%I drop column %I', r.schema_name, p_table, p_column);
  update public.project_tables set columns = (select jsonb_agg(c) from jsonb_array_elements(columns) c where c->>'name' <> p_column)
    where project_id = p and name = p_table;
end $$;

-- Renomeia o rótulo (o nome técnico não muda, para não quebrar dashboards)
create or replace function public.rename_column(p uuid, p_table text, p_column text, p_label text) returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  select * into r from private._resolve(p, p_table, true);
  update public.project_tables set columns = (select jsonb_agg(case when c->>'name' = p_column then c || jsonb_build_object('label', p_label) else c end)
    from jsonb_array_elements(columns) c) where project_id = p and name = p_table;
end $$;

create or replace function public.rename_table(p uuid, p_table text, p_label text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private._resolve(p, p_table, true);
  update public.project_tables set label = p_label where project_id = p and name = p_table;
end $$;

-- ===== Filtros seguros =====
-- p_filters: [{"col":"valor","op":"gte","value":"100"}]; ops: eq neq gt gte lt lte contains starts empty not_empty
create or replace function private._where(cols jsonb, filters jsonb) returns text
language plpgsql immutable set search_path = '' as $$
declare f jsonb; col text; typ text; op text; v text; parts text[] := '{}'; cond text;
begin
  if filters is null or jsonb_typeof(filters) <> 'array' or jsonb_array_length(filters) = 0 then return 'true'; end if;
  for f in select * from jsonb_array_elements(filters) loop
    col := f->>'col'; op := f->>'op'; v := f->>'value';
    if col in ('id') then typ := 'bigint'; elsif col = 'created_at' then typ := 'timestamptz';
    else select private._sqltype(c->>'type') into typ from jsonb_array_elements(cols) c where c->>'name' = col; end if;
    perform private._require(typ is not null, 'Coluna de filtro inválida: ' || coalesce(col,'?'));
    cond := case op
      when 'eq' then format('%I = %L::%s', col, v, typ)
      when 'neq' then format('%I is distinct from %L::%s', col, v, typ)
      when 'gt' then format('%I > %L::%s', col, v, typ)
      when 'gte' then format('%I >= %L::%s', col, v, typ)
      when 'lt' then format('%I < %L::%s', col, v, typ)
      when 'lte' then format('%I <= %L::%s', col, v, typ)
      when 'contains' then format('%I::text ilike %L', col, '%' || replace(replace(v,'%','\%'),'_','\_') || '%')
      when 'starts' then format('%I::text ilike %L', col, replace(replace(v,'%','\%'),'_','\_') || '%')
      when 'empty' then format('%I is null', col)
      when 'not_empty' then format('%I is not null', col)
    end;
    perform private._require(cond is not null, 'Operador de filtro inválido: ' || coalesce(op,'?'));
    parts := parts || cond;
  end loop;
  return array_to_string(parts, ' and ');
end $$;

drop function public.list_rows(uuid, text, int, int, text, boolean);
create function public.list_rows(p uuid, p_table text, p_limit int default 100, p_offset int default 0,
  p_order text default 'id', p_desc boolean default true, p_filters jsonb default '[]') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r record; rows jsonb; total bigint; w text;
begin
  select * into r from private._resolve(p, p_table);
  w := private._where(r.cols, p_filters);
  if p_order not in ('id','created_at') and not exists(select 1 from jsonb_array_elements(r.cols) c where c->>'name' = p_order) then p_order := 'id'; end if;
  execute format('select count(*) from %I.%I where %s', r.schema_name, p_table, w) into total;
  execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]'') from (select * from %I.%I where %s order by %I %s limit %s offset %s) t',
    r.schema_name, p_table, w, p_order, case when p_desc then 'desc' else 'asc' end, least(greatest(p_limit,1),1000), greatest(p_offset,0)) into rows;
  return jsonb_build_object('rows', rows, 'total', total, 'columns', r.cols);
end $$;

drop function public.aggregate(uuid, text, text, text, text, text, int);
create function public.aggregate(p uuid, p_table text, p_agg text default 'count', p_metric text default null,
  p_group text default null, p_trunc text default null, p_limit int default 50, p_filters jsonb default '[]') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r record; expr text; grp text; res jsonb; valid text[]; w text;
begin
  select * into r from private._resolve(p, p_table);
  w := private._where(r.cols, p_filters);
  select array_agg(c->>'name') || array['id','created_at'] into valid from jsonb_array_elements(r.cols) c;
  perform private._require(p_agg in ('count','sum','avg','min','max'), 'Agregação inválida');
  if p_agg = 'count' then expr := 'count(*)';
  else perform private._require(p_metric = any(valid), 'Coluna de métrica inválida'); expr := format('%s(%I)', p_agg, p_metric); end if;
  if p_group is null or p_group = '' then
    execute format('select jsonb_build_array(jsonb_build_object(''label'', ''Total'', ''value'', %s)) from %I.%I where %s', expr, r.schema_name, p_table, w) into res;
    return res;
  end if;
  perform private._require(p_group = any(valid), 'Coluna de agrupamento inválida');
  if p_trunc in ('day','week','month','year') then grp := format('date_trunc(%L, %I)::date', p_trunc, p_group);
  else grp := format('%I', p_group); end if;
  execute format('select coalesce(jsonb_agg(jsonb_build_object(''label'', g, ''value'', v) order by %s), ''[]'') from (select %s as g, %s as v from %I.%I where %s group by 1 order by %s limit %s) s',
    case when p_trunc is not null then 'g' else 'v desc' end, grp, expr, r.schema_name, p_table, w,
    case when p_trunc is not null then '1' else '2 desc' end, least(greatest(p_limit,1),500)) into res;
  return res;
end $$;

-- Valores distintos de uma coluna (para listas de filtro)
create or replace function public.distinct_values(p uuid, p_table text, p_column text, p_limit int default 200) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r record; res jsonb;
begin
  select * into r from private._resolve(p, p_table);
  perform private._require(exists(select 1 from jsonb_array_elements(r.cols) c where c->>'name' = p_column), 'Coluna inválida');
  execute format('select coalesce(jsonb_agg(v order by v), ''[]'') from (select distinct %I as v from %I.%I where %I is not null limit %s) s',
    p_column, r.schema_name, p_table, p_column, least(greatest(p_limit,1),1000)) into res;
  return res;
end $$;

-- Permissões
do $$ declare f text; begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname = 'public' and p.proname in ('list_members','invite_member','set_member_role','remove_member','add_column','drop_column',
           'rename_column','rename_table','list_rows','aggregate','distinct_values'))
       or (n.nspname = 'private' and p.proname in ('_sqltype','_where')) loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke execute on function private.accept_invites() from public, anon, authenticated;
