create table public.ai_usage (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  model text not null,
  effort text,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_read_tokens int not null default 0,
  created_at timestamptz not null default now()
);
create index on public.ai_usage(workspace_id, created_at desc);
alter table public.ai_usage enable row level security;
create policy aiu_select on public.ai_usage for select to authenticated using (private.is_ws_member(workspace_id));
