create table public.mcp_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  token_hash text not null unique,
  token_hint text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index on public.mcp_tokens(user_id);
alter table public.mcp_tokens enable row level security;
create policy mt_own on public.mcp_tokens for select to authenticated using (user_id = auth.uid());
create policy mt_del on public.mcp_tokens for delete to authenticated using (user_id = auth.uid());

-- Gera a chave do conector: devolve o texto UMA vez; guarda só o hash
create or replace function public.create_mcp_token(p_name text) returns text
language plpgsql security definer set search_path = '' as $$
declare tok text := 'pia_' || encode(extensions.gen_random_bytes(24), 'hex');
begin
  perform private._require(auth.uid() is not null, 'Faça login');
  perform private._require((select count(*) from public.mcp_tokens where user_id = auth.uid()) < 10, 'Limite de 10 chaves; revogue alguma antes');
  insert into public.mcp_tokens(user_id, name, token_hash, token_hint)
    values (auth.uid(), coalesce(nullif(trim(p_name), ''), 'Claude'), encode(extensions.digest(tok, 'sha256'), 'hex'), '…' || right(tok, 4));
  return tok;
end $$;
revoke execute on function public.create_mcp_token(text) from public, anon;
grant execute on function public.create_mcp_token(text) to authenticated;

-- Só o servidor: resolve a chave para o usuário
create or replace function public.svc_mcp_user(p_token text) returns table(user_id uuid, email text)
language plpgsql security definer set search_path = '' as $$
declare h text := encode(extensions.digest(p_token, 'sha256'), 'hex');
begin
  update public.mcp_tokens set last_used_at = now() where token_hash = h;
  return query select t.user_id, u.email::text from public.mcp_tokens t join auth.users u on u.id = t.user_id where t.token_hash = h;
end $$;
revoke execute on function public.svc_mcp_user(text) from public, anon, authenticated;
grant execute on function public.svc_mcp_user(text) to service_role;
