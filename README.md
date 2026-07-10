# TF News

Plataforma interna de monitoramento de mercado e inteligência editorial da TransFAST.

## O que já funciona

- painel executivo com filtro global por ICP;
- cadastro e validação de fontes RSS/Atom;
- coleta manual com timeout, limite de tamanho, User-Agent e proteção básica contra SSRF;
- normalização, canonicalização, hash e deduplicação idempotente;
- classificação determinística multi-ICP, temas, região, impacto logístico e relevância;
- seleção múltipla de notícias;
- briefing estruturado com fatos e fontes;
- artigo original editável, SEO básico e salvamento interno;
- integração WordPress protegida, sempre com `status: draft` e bloqueio de duplicidade;
- logs de coleta e endpoints `/api/health` e `/api/ready`;
- autenticação e acesso pelo ambiente privado do Sites.

## Estrutura

```text
app/
  api/                 fontes, coleta, notícias, conteúdo, WordPress e saúde
  tf-news-app.tsx      experiência principal
db/
  schema.ts            modelo relacional
  runtime.ts           inicialização segura do D1
lib/
  editorial.ts         RSS, URL, SSRF, classificação e scoring
tests/                 testes críticos
```

## Desenvolvimento local

Use Node.js 22.13 ou superior. Copie `.env.example` para `.env.local`, preencha somente o que for necessário e execute `npm install` e `npm run dev`. O banco D1 local é criado pelo ambiente de desenvolvimento quando a primeira API é chamada.

Validação: `npm run lint`, `npm run typecheck`, `npm test` e `npm run build`.

## WordPress

No WordPress, crie um usuário de integração com permissão apenas para posts e gere uma *Application Password* no perfil desse usuário. Configure `WORDPRESS_BASE_URL`, `WORDPRESS_USERNAME` e `WORDPRESS_APPLICATION_PASSWORD` somente no ambiente do servidor. O sistema usa `/wp-json/wp/v2/posts` e força todos os envios para rascunho.

## Agendamento

A coleta manual já é idempotente. Em produção, acione o coletor de duas a três vezes por dia por um cron autenticado e mantenha `CRON_SECRET` no ambiente hospedado. O MVP não executa processo contínuo dentro da interface.

## Decisões de arquitetura

Monólito modular com rotas servidoras; D1 para persistência estruturada; SIWC/política de acesso do Sites para identidade; regras determinísticas antes de qualquer provedor de IA; integrações externas isoladas; WordPress *draft-only*. Credenciais nunca chegam ao navegador.

## Limitações conhecidas

- o parser cobre RSS/Atom comuns, mas feeds XML muito fora do padrão podem exigir um conector específico;
- a proteção SSRF valida esquema e endereços privados explícitos, mas DNS rebinding deve receber uma camada de rede adicional em produção;
- a geração atual usa fallback editorial determinístico; a abstração para provedor de IA é a próxima evolução;
- o agendamento externo e a tela detalhada de logs ficam para a próxima fatia operacional.

## Backlog V2

Agrupamento semântico de eventos, tendências, comandos avançados em linguagem natural, calendário editorial, newsletter, Search Console, analytics, alertas por ICP, múltiplos usuários, aprovações por níveis, banco de imagens autorizado, CRM e integração com TF Insights.

