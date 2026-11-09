# Plataforma IA

Plataforma para criar sistemas, BI e telas conectados aos dados da empresa (ERP Sankhya, APIs, bancos),
com um Agente de IA que constrói a partir de uma descrição. Inspirada na arquitetura da Mitra.

- **Site:** https://plataforma-ia-otxp.vercel.app
- **Guia de configuração e testes:** [GUIA.md](GUIA.md)

## Arquitetura

```
Navegador (Vite + React)  ──►  Supabase
                               ├─ Postgres: workspaces, projetos, RLS, funções RPC
                               │    └─ cada projeto tem um schema próprio (p_xxxx) com suas tabelas
                               ├─ Vault: credenciais das integrações (criptografadas)
                               ├─ pg_cron + pg_net: agendador a cada 5 min
                               └─ Edge Functions
                                    ├─ api            conectores, consultas ao vivo, importações,
                                    │                 agendador, webhooks e Agente IA (Claude)
                                    └─ sankhya-mock   Sankhya de demonstração (dados fictícios)
```

## Funcionalidades

| Fase | O que tem |
|---|---|
| 1 | Login, workspaces, projetos, tabelas (do zero ou CSV), grade editável, dashboards |
| 2 | Membros com papéis (dono, dev, business), convites (inclusive para quem ainda não tem conta), editar colunas, filtros |
| 3 | Integrador: **Sankhya** (Gateway OAuth, Gateway token+appkey, acesso direto), **API REST**, **PostgreSQL**; credenciais no Vault; **consultas ao vivo** com cache; teste de conexão |
| 4 | Automações: **importações agendadas** (Sankhya → tabela local), **webhooks** de entrada, histórico de execuções |
| 5 | **Agente IA** (Claude) que lista dados, testa SQL no Sankhya, cria tabelas, consultas, importações, dashboards e telas — agindo com as permissões de quem pede |
| 7 | **Conector MCP**: usar a plataforma de dentro do Claude (claude.ai, Desktop, Claude Code) com a assinatura do usuário; chaves por usuário, revogáveis |
| 6 | **Telas (apps)** por blocos (KPI, gráficos, lista, formulário, texto) sobre tabelas ou dados ao vivo; publicar versões, voltar versão, link para usuários business |

## Segurança

- Navegador nunca executa SQL livre: tudo passa por funções que conferem permissão e validam nomes (anti-injeção).
- RLS em todas as tabelas da plataforma; dados de cada projeto ficam num schema sem acesso direto.
- Credenciais de integrações ficam no **Supabase Vault**; só a Edge Function as lê, com a chave de serviço.
- Conectores aceitam apenas `SELECT`; bloqueiam endereços de rede interna (SSRF).
- O Agente IA usa o mesmo cliente do usuário: não consegue fazer nada que o usuário não poderia.

## Desenvolvimento

```bash
npm install
npm run dev
```

O app usa por padrão o projeto Supabase `plataforma-ia` (veja `src/lib/supabase.ts` / `.env.example`).

### Banco e funções

- `supabase/migrations/`: migrações em ordem (recriam o banco do zero). A de fase 3 agenda o `pg_cron`
  apontando para a URL deste projeto; ajuste se recriar em outro.
- `supabase/functions/api` e `supabase/functions/sankhya-mock`: código das Edge Functions
  (`api` e `sankhya-mock` publicadas com `verify_jwt = false`; cada rota faz a própria autenticação).

## Próximos passos sugeridos

- Túnel (Cloudflare Tunnel) para Sankhya instalado na rede interna
- Conectores SQL Server/Oracle diretos, TOTVS, Omie
- Funções de servidor com código próprio (em sandbox) e envio de e-mail/WhatsApp
- SMTP próprio no Supabase para e-mails de cadastro
