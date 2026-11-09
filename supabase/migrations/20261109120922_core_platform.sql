-- ===== Núcleo da plataforma: workspaces, membros, projetos =====
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 80),
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'dev' check (role in ('owner','dev','business')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index on public.workspace_members(user_id);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  description text,
  schema_name text not null unique,
  created_at timestamptz not null default now()
);
create index on public.projects(workspace_id);

-- Registro das tabelas de dados de cada projeto
create table public.project_tables (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  label text not null,
  columns jsonb not null default '[]',
  created_at timestamptz not null default now(),
  unique (project_id, name)
);

create table public.dashboards (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create index on public.dashboards(project_id);

create table public.widgets (
  id uuid primary key default gen_random_uuid(),
  dashboard_id uuid not null references public.dashboards(id) on delete cascade,
  title text not null,
  chart_type text not null check (chart_type in ('kpi','bar','line','pie','table')),
  table_name text not null,
  group_by text,
  date_trunc text check (date_trunc in ('day','week','month','year')),
  agg text not null default 'count' check (agg in ('count','sum','avg','min','max')),
  metric_column text,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index on public.widgets(dashboard_id);

-- ===== Funções auxiliares de permissão =====
create or replace function public.ws_role(ws uuid) returns text
language sql stable security definer set search_path = '' as $$
  select role from public.workspace_members where workspace_id = ws and user_id = auth.uid()
$$;

create or replace function public.is_ws_member(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.workspace_members where workspace_id = ws and user_id = auth.uid())
$$;

create or replace function public.is_ws_dev(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.workspace_members where workspace_id = ws and user_id = auth.uid() and role in ('owner','dev'))
$$;

create or replace function public.project_ws(p uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select workspace_id from public.projects where id = p
$$;

-- ===== RLS =====
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.projects enable row level security;
alter table public.project_tables enable row level security;
alter table public.dashboards enable row level security;
alter table public.widgets enable row level security;

create policy ws_select on public.workspaces for select to authenticated using (public.is_ws_member(id));
create policy ws_update on public.workspaces for update to authenticated using (public.ws_role(id) = 'owner');
create policy ws_delete on public.workspaces for delete to authenticated using (public.ws_role(id) = 'owner');

create policy wm_select on public.workspace_members for select to authenticated using (public.is_ws_member(workspace_id));
create policy wm_write on public.workspace_members for all to authenticated
  using (public.ws_role(workspace_id) = 'owner') with check (public.ws_role(workspace_id) = 'owner');

create policy pr_select on public.projects for select to authenticated using (public.is_ws_member(workspace_id));
create policy pr_update on public.projects for update to authenticated using (public.is_ws_dev(workspace_id)) with check (public.is_ws_dev(workspace_id));

create policy pt_select on public.project_tables for select to authenticated using (public.is_ws_member(public.project_ws(project_id)));

create policy db_select on public.dashboards for select to authenticated using (public.is_ws_member(public.project_ws(project_id)));
create policy db_write on public.dashboards for all to authenticated
  using (public.is_ws_dev(public.project_ws(project_id))) with check (public.is_ws_dev(public.project_ws(project_id)));

create policy wg_select on public.widgets for select to authenticated
  using (public.is_ws_member(public.project_ws((select d.project_id from public.dashboards d where d.id = dashboard_id))));
create policy wg_write on public.widgets for all to authenticated
  using (public.is_ws_dev(public.project_ws((select d.project_id from public.dashboards d where d.id = dashboard_id))))
  with check (public.is_ws_dev(public.project_ws((select d.project_id from public.dashboards d where d.id = dashboard_id))));
