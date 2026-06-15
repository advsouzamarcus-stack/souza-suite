# Souza Suite Cloud — versão migrada para nuvem

Esta é uma base funcional para substituir o HTML monolítico/localStorage por uma aplicação com frontend estático, Netlify Functions e Supabase/PostgreSQL.

## O que já está pronto
- Frontend HTML + CSS + JS modular simples.
- API serverless em `/api/*`.
- Login com JWT.
- Usuários com senha protegida por bcrypt.
- CRUD de clientes, processos, tarefas, financeiro e agendamentos.
- Schema PostgreSQL/Supabase.
- Rotas para Datajud e Google Calendar via variáveis de ambiente.
- Pronto para Netlify.

## O que precisa ser configurado
1. Criar projeto no Supabase.
2. Rodar `supabase/schema.sql` no SQL Editor.
3. Definir variáveis de ambiente no Netlify conforme `.env.example`.
4. Criar o primeiro admin via rota `/api/auth/bootstrap-admin` usando `SETUP_KEY`.
5. Migrar dados do localStorage do sistema antigo para as tabelas.

## Segurança
As senhas e chaves que estavam no HTML público antigo devem ser substituídas. Não publique API keys, senhas ou links privados no frontend.
