# Guia: configurar e testar

## 1. Ajustes no Supabase (uma vez)

No painel do projeto **plataforma-ia** → **Authentication**:

1. **URL Configuration → Site URL**: `https://plataforma-ia-otxp.vercel.app`
2. **Sign In / Providers → Email**: desligue **Confirm email** enquanto estiver testando
   (o e-mail padrão do Supabase só entrega para membros da sua equipe no Supabase).
3. Opcional: em **Attack Protection**, ligue a proteção contra senhas vazadas.

## 2. Entrar

Abra o site → **Criar conta** → crie um **workspace** (ex.: "Foco Fertilizantes") → crie um **projeto**.

## 3. Testar com o Sankhya de demonstração (sem credenciais)

1. Aba **Integrações** → **+ Nova integração** → **Sankhya (demonstração)** → **Salvar e testar** → deve ficar **● Conectado**.
2. No projeto → **⚡ Consulta ao vivo** → em "Exemplos Sankhya" escolha **Vendas dos últimos 90 dias** → **▶ Executar** → **Salvar consulta**.
3. **📊 Novo dashboard** → **+ Widget** → Fonte: **Consulta ao vivo** → ex.: Soma de `VLRNOTA` por `DTNEG` (Mês).
   Os blocos ao vivo mostram **● ao vivo** e se atualizam a cada 30 segundos.
4. **⚙️ Automações** → **+ Importação** → `SELECT * FROM TGFCAB`, destino `notas_sankhya`, "A cada hora" → a tabela aparece no menu.
5. **🧩 Nova tela** → adicione blocos (KPI, lista, formulário) → **Publicar** → **Abrir app**.

## 4. Conectar o Sankhya de verdade

**Integrações → + Nova integração → Sankhya** e escolha a forma de acesso:

| Forma | Quando usar | O que você precisa |
|---|---|---|
| **Gateway – OAuth** (recomendado) | Sankhya com API Gateway (sankhya.com.br) | Client ID, Client Secret e X-Token, gerados no portal do desenvolvedor Sankhya / Área do Cliente |
| **Gateway – Token + AppKey** | Contas de Gateway no modelo antigo | Token, AppKey, usuário e senha do Sankhya |
| **Servidor direto** | Sankhya Cloud (`suaempresa.sankhyacloud.com.br`) ou servidor exposto por túnel | Endereço, usuário e senha do Sankhya |

Dicas:
- Crie um **usuário do Sankhya só para integração**, com acesso de leitura às tabelas necessárias.
- As credenciais vão criptografadas para o servidor e **não voltam para a tela** (na edição, deixe em branco para manter).
- Se o banco do Sankhya for **SQL Server**, use `SELECT 1 AS OK` no "SQL de teste" e troque `SYSDATE - 90` por `GETDATE() - 90` nas consultas.
- **Sankhya instalado na rede interna** (sem endereço público): é preciso expor com um túnel (ex.: Cloudflare Tunnel) e usar o modo "Servidor direto" com o endereço do túnel.

## 5. Agente IA

1. Crie uma chave em **console.anthropic.com → API Keys** (e adicione créditos em Billing; dá para definir limite mensal).
2. No projeto → **✨ Agente IA → ✳ Modelos de IA** → cole a chave em "Conectar chave de API".
   No mesmo painel: escolha o modelo e o esforço (low → max), marque favoritos com ★ e acompanhe o uso/custo estimado do mês.
   A assinatura do claude.ai (Pro/Max) não pode ser usada aqui: os termos da Anthropic só permitem chave de API em produtos de terceiros.
3. Peça, por exemplo:
   *"Crie um dashboard de vendas do Sankhya ao vivo: total vendido no mês, vendas por vendedor e evolução diária."*

O agente testa o SQL no Sankhya, cria a consulta ao vivo e o dashboard. Cada pedido consome créditos da sua conta Anthropic.

## 6. Equipe

**Membros → Convidar**: informe o e-mail e o papel.
- **Dono**: tudo. **Desenvolvedor**: constrói (integrações, tabelas, telas, agente). **Business**: usa os apps e lança dados.
- Se a pessoa ainda não tem conta, o convite fica pendente e vale automaticamente quando ela se cadastrar com o mesmo e-mail.

## 7. Webhooks

**Automações → + Webhook** → informe a tabela de destino → copie o endereço.
Outros sistemas enviam `POST` com JSON (objeto ou lista) e os dados viram linhas na tabela. Trate o endereço como uma senha.
