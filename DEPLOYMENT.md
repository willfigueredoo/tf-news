# GitHub e Vercel

O TF News mantém o Vinext e possui dois destinos de build independentes:

- `npm run build`: build atual para Cloudflare/Sites em `dist/`;
- `npm run build:vercel`: build Vinext + Nitro para Vercel em `.vercel/output/`.

## GitHub

O repositório usa a branch `main` e o remoto `origin`. Cada push e pull request executa lint, typecheck, testes, build Cloudflare e build Vercel pelo GitHub Actions.

Nunca inclua tokens na URL do remoto nem confirme arquivos `.env*`, `.dev.vars*`, `.npmrc`, chaves privadas, credenciais JSON ou bancos locais.

## Configuração Vercel

O `vercel.json` versionado substitui a detecção incorreta de Next.js:

- Framework Preset: `Nitro`;
- Install Command: `npm ci`;
- Build Command: `npm run build:vercel`;
- Output Directory: deixe sem override.

O Nitro gera a Build Output API v3 diretamente em `.vercel/output/`, incluindo arquivos estáticos, roteamento e a função SSR. Não configure `.next`, `dist`, `dist/client` ou `.output` no painel.

Se o painel tiver overrides antigos, remova-os ou marque as opções para usar a configuração do repositório. Depois, solicite um redeploy do último commit sem reutilizar o cache de build antigo.

## D1 na Vercel

No Cloudflare/Sites, o banco continua usando o binding D1 `DB`. Na Vercel, um adaptador server-only consulta o mesmo D1 pela API HTTP oficial do Cloudflare. Nenhuma migração de banco é necessária.

Configure em Preview e Production:

- `CLOUDFLARE_ACCOUNT_ID`;
- `CLOUDFLARE_D1_DATABASE_ID`;
- `CLOUDFLARE_API_TOKEN` com somente D1 Read e D1 Write para o banco necessário.

As três variáveis são obrigatórias para as APIs de dados e nunca devem usar prefixo `NEXT_PUBLIC_` ou `VITE_`.

## WordPress

Se a integração estiver ativa, configure também:

- `WORDPRESS_BASE_URL`;
- `WORDPRESS_USERNAME`;
- `WORDPRESS_APPLICATION_PASSWORD`.

## Acesso

A política privada do Sites não acompanha o deploy Vercel. Antes de usar dados reais, ative Deployment Protection na Vercel ou mantenha o domínio Vercel restrito até que uma autenticação própria seja aprovada.

## Variáveis reservadas

`DATABASE_URL`, `APP_URL`, `AUTH_SECRET`, `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`, `CRON_SECRET` e `ENCRYPTION_KEY` estão no exemplo, mas não são necessárias para este build Vercel atual.

## Migrations sem perda de dados

O projeto usa Drizzle, não Prisma. A migration inicial está em `drizzle/0000_huge_sentry.sql` e o mesmo banco D1 é compartilhado pelos dois runtimes.

Para mudanças futuras:

1. faça backup e teste de restauração;
2. altere `db/schema.ts`;
3. gere uma migration versionada com `npm run db:generate`;
4. revise o SQL e rejeite operações destrutivas não planejadas;
5. aplique primeiro em Preview/Staging;
6. aplique uma única vez no D1 de produção;
7. valide `/api/ready` e operações de leitura e escrita.

Não use `drizzle-kit push`, reset, drop ou recriação do banco em produção.
