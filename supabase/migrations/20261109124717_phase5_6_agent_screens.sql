-- Garante que consultas/automações só usem integrações do mesmo workspace do projeto
create or replace function private.check_integration_ws() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.integration_id is not null and
     (select workspace_id from public.integrations where id = new.integration_id) is distinct from private.project_ws(new.project_id) then
    raise exception 'Integração não pertence a este workspace' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger online_queries_check_ws before insert or update on public.online_queries for each row execute function private.check_integration_ws();
create trigger automations_check_ws before insert or update on public.automations for each row execute function private.check_integration_ws();

-- Widgets: a consulta precisa ser do mesmo projeto do dashboard
create or replace function private.check_widget_query() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.query_id is not null and (select project_id from public.online_queries where id = new.query_id)
     is distinct from (select project_id from public.dashboards where id = new.dashboard_id) then
    raise exception 'Consulta não pertence a este projeto' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger widgets_check_query before insert or update on public.widgets for each row execute function private.check_widget_query();

-- ===== Agente de IA =====
create table public.agent_chats (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default 'Nova conversa',
  created_at timestamptz not null default now()
);
create index on public.agent_chats(project_id, user_id);
create table public.agent_messages (
  id bigint generated always as identity primary key,
  chat_id uuid not null references public.agent_chats(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content jsonb not null,
  created_at timestamptz not null default now()
);
create index on public.agent_messages(chat_id, id);
alter table public.agent_chats enable row level security;
alter table public.agent_messages enable row level security;
create policy ac_own on public.agent_chats for all to authenticated
  using (user_id = auth.uid() and private.is_ws_member(private.project_ws(project_id)))
  with check (user_id = auth.uid() and private.is_ws_dev(private.project_ws(project_id)));
create policy am_select on public.agent_messages for select to authenticated
  using (exists(select 1 from public.agent_chats c where c.id = chat_id and c.user_id = auth.uid()));

-- ===== Telas (apps) com versões =====
create table public.screens (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  draft jsonb not null default '{"blocks":[]}',
  published_version int,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index on public.screens(project_id);
create table public.screen_versions (
  id uuid primary key default gen_random_uuid(),
  screen_id uuid not null references public.screens(id) on delete cascade,
  version int not null,
  spec jsonb not null,
  note text,
  published_by uuid references auth.users(id) on delete set null,
  published_at timestamptz not null default now(),
  unique (screen_id, version)
);
alter table public.screens enable row level security;
alter table public.screen_versions enable row level security;
create policy sc_select on public.screens for select to authenticated using (private.is_ws_member(private.project_ws(project_id)));
create policy sc_write on public.screens for all to authenticated
  using (private.is_ws_dev(private.project_ws(project_id))) with check (private.is_ws_dev(private.project_ws(project_id)));
create policy sv_select on public.screen_versions for select to authenticated
  using (private.is_ws_member(private.project_ws((select s.project_id from public.screens s where s.id = screen_id))));

create or replace function public.publish_screen(p_screen uuid, p_note text default null) returns int
language plpgsql security definer set search_path = '' as $$
declare pid uuid; v int; d jsonb;
begin
  select project_id, draft into pid, d from public.screens where id = p_screen;
  perform private._require(pid is not null, 'Tela não encontrada');
  perform private._require(private.is_ws_dev(private.project_ws(pid)), 'Sem permissão (precisa ser dev)');
  select coalesce(max(version), 0) + 1 into v from public.screen_versions where screen_id = p_screen;
  insert into public.screen_versions(screen_id, version, spec, note, published_by) values (p_screen, v, d, p_note, auth.uid());
  update public.screens set published_version = v where id = p_screen;
  return v;
end $$;

create or replace function public.rollback_screen(p_screen uuid, p_version int) returns void
language plpgsql security definer set search_path = '' as $$
declare pid uuid; sp jsonb;
begin
  select project_id into pid from public.screens where id = p_screen;
  perform private._require(private.is_ws_dev(private.project_ws(pid)), 'Sem permissão (precisa ser dev)');
  select spec into sp from public.screen_versions where screen_id = p_screen and version = p_version;
  perform private._require(sp is not null, 'Versão não encontrada');
  update public.screens set published_version = p_version, draft = sp, updated_at = now() where id = p_screen;
end $$;

-- Meu papel no workspace (para a interface esconder o que não pode)
create or replace function public.my_role(p_workspace uuid) returns text
language sql stable security definer set search_path = '' as $$ select private.ws_role(p_workspace) $$;

do $$ declare f text; begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('publish_screen','rollback_screen','my_role') loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke execute on function private.check_integration_ws() from public, anon, authenticated;
revoke execute on function private.check_widget_query() from public, anon, authenticated;
