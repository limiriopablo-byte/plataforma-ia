create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ===== Integrações (por workspace) =====
create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  kind text not null check (kind in ('rest','sankhya','postgres','anthropic')),
  config jsonb not null default '{}',          -- dados NÃO secretos (URL, modo, etc.)
  secret_id uuid,                               -- credenciais no Vault
  status text not null default 'new' check (status in ('new','ok','error')),
  last_error text,
  last_tested_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.integrations(workspace_id);
alter table public.integrations enable row level security;
create policy int_select on public.integrations for select to authenticated using (private.is_ws_member(workspace_id));

-- ===== Consultas ao vivo (tempo real) =====
create table public.online_queries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  integration_id uuid not null references public.integrations(id) on delete cascade,
  name text not null,
  query text not null,
  columns jsonb not null default '[]',
  cache_seconds int not null default 30 check (cache_seconds between 0 and 86400),
  created_at timestamptz not null default now()
);
create index on public.online_queries(project_id);
alter table public.online_queries enable row level security;
create policy oq_select on public.online_queries for select to authenticated using (private.is_ws_member(private.project_ws(project_id)));
create policy oq_write on public.online_queries for all to authenticated
  using (private.is_ws_dev(private.project_ws(project_id))) with check (private.is_ws_dev(private.project_ws(project_id)));

create table public.query_cache (
  query_id uuid primary key references public.online_queries(id) on delete cascade,
  fetched_at timestamptz not null default now(),
  rows jsonb not null
);
alter table public.query_cache enable row level security;  -- só o servidor acessa

-- ===== Automações: importações agendadas e webhooks =====
create table public.automations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('import','webhook')),
  integration_id uuid references public.integrations(id) on delete cascade,
  query text,
  target_table text not null,
  mode text not null default 'replace' check (mode in ('replace','append')),
  schedule_minutes int check (schedule_minutes is null or schedule_minutes >= 5),
  enabled boolean not null default true,
  webhook_token text unique,
  last_run_at timestamptz,
  last_status text,
  last_message text,
  created_at timestamptz not null default now()
);
create index on public.automations(project_id);
alter table public.automations enable row level security;
create policy au_select on public.automations for select to authenticated using (private.is_ws_member(private.project_ws(project_id)));
create policy au_write on public.automations for all to authenticated
  using (private.is_ws_dev(private.project_ws(project_id))) with check (private.is_ws_dev(private.project_ws(project_id)));

create table public.automation_runs (
  id bigint generated always as identity primary key,
  automation_id uuid not null references public.automations(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  rows int,
  message text,
  trigger text
);
create index on public.automation_runs(automation_id, started_at desc);
alter table public.automation_runs enable row level security;
create policy ar_select on public.automation_runs for select to authenticated
  using (private.is_ws_member(private.project_ws((select a.project_id from public.automations a where a.id = automation_id))));

-- Widgets podem usar uma consulta ao vivo como fonte
alter table public.widgets add column source_type text not null default 'table' check (source_type in ('table','query'));
alter table public.widgets add column query_id uuid references public.online_queries(id) on delete cascade;
alter table public.widgets add column filters jsonb not null default '[]';
alter table public.widgets alter column table_name drop not null;

-- ===== Salvar integração (credenciais no Vault) =====
create or replace function public.save_integration(p_workspace uuid, p_id uuid, p_name text, p_kind text, p_config jsonb, p_secrets jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare iid uuid := coalesce(p_id, gen_random_uuid()); sid uuid; old_ws uuid;
begin
  perform private._require(private.is_ws_dev(p_workspace), 'Sem permissão (precisa ser dev)');
  perform private._require(p_kind in ('rest','sankhya','postgres','anthropic'), 'Tipo de integração inválido');
  if p_id is not null then
    select workspace_id, secret_id into old_ws, sid from public.integrations where id = p_id;
    perform private._require(old_ws = p_workspace, 'Integração não encontrada');
  end if;
  -- só grava segredo se vier preenchido (na edição, campo vazio mantém o atual)
  if p_secrets is not null and p_secrets <> '{}'::jsonb then
    if sid is null then
      sid := vault.create_secret(p_secrets::text, 'integration_' || iid::text, 'Credenciais da integração ' || p_name);
    else
      perform vault.update_secret(sid, (
        select (coalesce((select decrypted_secret from vault.decrypted_secrets where id = sid), '{}')::jsonb || p_secrets)::text));
    end if;
  end if;
  insert into public.integrations(id, workspace_id, name, kind, config, secret_id, status)
    values (iid, p_workspace, p_name, p_kind, coalesce(p_config,'{}'), sid, 'new')
  on conflict (id) do update set name = excluded.name, config = excluded.config, secret_id = excluded.secret_id, status = 'new', last_error = null;
  return iid;
end $$;

create or replace function public.delete_integration(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare ws uuid; sid uuid;
begin
  select workspace_id, secret_id into ws, sid from public.integrations where id = p_id;
  perform private._require(private.is_ws_dev(ws), 'Sem permissão (precisa ser dev)');
  delete from public.integrations where id = p_id;
  if sid is not null then delete from vault.secrets where id = sid; end if;
end $$;

create or replace function public.create_webhook(p uuid, p_name text, p_target text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare aid uuid;
begin
  perform private._resolve(p, p_target, true);
  insert into public.automations(project_id, name, kind, target_table, mode, webhook_token)
    values (p, p_name, 'webhook', p_target, 'append', encode(extensions.gen_random_bytes(24), 'hex')) returning id into aid;
  return aid;
end $$;

-- ===== Funções só para o servidor (Edge Functions com service_role) =====
create or replace function public.svc_integration_secret(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((select decrypted_secret from vault.decrypted_secrets s join public.integrations i on i.secret_id = s.id where i.id = p_id), '{}')::jsonb
$$;

create or replace function public.svc_member_role(p_user uuid, p_workspace uuid) returns text
language sql stable security definer set search_path = '' as $$
  select role from public.workspace_members where user_id = p_user and workspace_id = p_workspace
$$;

-- Cria a tabela-destino (se não existir) e grava as linhas de uma importação
create or replace function public.svc_write_rows(p uuid, p_table text, p_label text, p_columns jsonb, p_rows jsonb, p_mode text) returns int
language plpgsql security definer set search_path = '' as $$
declare sch text; cols jsonb; c jsonb; n int := 0; d jsonb; cl text; typ text;
begin
  select schema_name into sch from public.projects where id = p;
  perform private._require(sch is not null, 'Projeto não encontrado');
  perform private._require(private._ident_ok(p_table), 'Nome de tabela inválido');
  select columns into cols from public.project_tables where project_id = p and name = p_table;
  if cols is null then
    execute format('create table %I.%I (id bigint generated by default as identity primary key, created_at timestamptz not null default now())', sch, p_table);
    cols := '[]';
    insert into public.project_tables(project_id, name, label, columns) values (p, p_table, coalesce(nullif(p_label,''), p_table), '[]');
  end if;
  -- adiciona colunas novas que vierem da fonte
  for c in select * from jsonb_array_elements(p_columns) loop
    if private._ident_ok(c->>'name') and not exists(select 1 from jsonb_array_elements(cols) x where x->>'name' = c->>'name') then
      typ := coalesce(private._sqltype(c->>'type'), 'text');
      execute format('alter table %I.%I add column %I %s', sch, p_table, c->>'name', typ);
      cols := cols || jsonb_build_array(jsonb_build_object('name', c->>'name', 'type', coalesce(c->>'type','text'), 'label', coalesce(c->>'label', c->>'name')));
    end if;
  end loop;
  update public.project_tables set columns = cols where project_id = p and name = p_table;
  if p_mode = 'replace' then execute format('truncate %I.%I', sch, p_table); end if;
  for d in select * from jsonb_array_elements(p_rows) loop
    cl := private._col_list(cols, d);
    if cl is null then continue; end if;
    execute format('insert into %I.%I (%s) select %s from jsonb_populate_record(null::%I.%I, $1)', sch, p_table, cl, cl, sch, p_table) using d;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Gera o segredo do agendador e agenda a chamada a cada 5 minutos
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'scheduler_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'scheduler_secret', 'Segredo para o pg_cron chamar a Edge Function scheduler');
  end if;
end $$;

create or replace function public.svc_check_scheduler(p_secret text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from vault.decrypted_secrets where name = 'scheduler_secret' and decrypted_secret = p_secret)
$$;

select cron.schedule('plataforma-scheduler', '*/5 * * * *', $cron$
  select net.http_post(
    url := 'https://cnizlyyiylfxzhhpkiah.supabase.co/functions/v1/scheduler',
    headers := jsonb_build_object('Content-Type','application/json','x-scheduler-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'scheduler_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 60000)
$cron$);

-- Permissões
do $$ declare f text; begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('save_integration','delete_integration','create_webhook') loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'svc\_%' loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
