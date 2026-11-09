# Plataforma IA

Plataforma para criar sistemas, tabelas e dashboards conectados a dados, inspirada na arquitetura da Mitra
(agente de IA + modelo de app + backend de dados seguro).

## Stack

- **Frontend:** Vite + React + TypeScript + Recharts (publicado na Vercel)
- **Backend:** Supabase (projeto `plataforma-ia`, região São Paulo): Postgres, Auth, RLS e funções RPC

## Como funciona

- **Workspace → Projetos.** Cada projeto ganha um *schema* próprio no Postgres (`p_xxxx`), isolado dos outros.
- As tabelas do projeto são criadas e lidas **apenas por funções RPC** (`create_table`, `list_rows`, `insert_rows`,
  `update_row`, `delete_rows`, `aggregate`) que conferem se o usuário é membro do workspace e validam os nomes de
  tabela e coluna (proteção contra injeção de SQL).
- **Papéis:** `owner` e `dev` criam estrutura (tabelas, dashboards); `business` usa os dados.
- **Dashboards:** os widgets guardam a configuração (tabela, cálculo, agrupamento) e o banco calcula com `aggregate`.
  Não há SQL livre vindo do navegador.

## Rodar localmente

```bash
npm install
npm run dev
```

Por padrão o app usa o projeto Supabase `plataforma-ia`. Para usar outro, copie `.env.example` para `.env.local`.

## Banco de dados

As migrações em `supabase/migrations/` recriam o banco do zero (aplicar em ordem).

## Roteiro

- [x] **Fase 1:** login, workspaces, projetos, tabelas (do zero ou importando CSV), grade com edição, dashboards
- [ ] **Fase 2:** convidar membros e papéis; editar colunas de uma tabela; filtros na grade
- [ ] **Fase 3:** conexões externas (Postgres, SQL Server, Oracle, ERP) e *data loaders* agendados (pg_cron)
- [ ] **Fase 4:** *server functions* (Edge Functions) com agendamento e webhooks
- [ ] **Fase 5:** agente de IA (Claude) que cria tabelas, dashboards e telas a partir de uma descrição
- [ ] **Fase 6:** apps gerados pelo agente publicados com versão, preview e rollback
