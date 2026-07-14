# Operação em produção

O TF News mantém Vinext e gera dois artefatos independentes:

- `npm run build`: Cloudflare/Sites em `dist/`;
- `npm run build:vercel`: Vinext + Nitro na Build Output API v3 em `.vercel/output/`.

## Vercel

Configuração esperada:

- Framework Preset: `Nitro`;
- Install Command: `npm ci`;
- Build Command: `npm run build:vercel`;
- Output Directory: sem override;
- Node.js: 24.x.

O `vercel.json` agenda `/api/cron/collect` diariamente às 11:00 UTC, correspondente a 08:00 em Brasília. Essa frequência permite deploy no plano Hobby. Para 08:00, 14:00 e 20:00, use o plano Pro e altere a expressão para `0 11,17,23 * * *`, ou configure um agendador externo autorizado. O endpoint exige `Authorization: Bearer $CRON_SECRET`, usa lock no D1 e registra a execução. Crons da Vercel só rodam no deployment de produção.

## Variáveis obrigatórias

Banco D1 acessado pela Vercel:

- `CLOUDFLARE_ACCOUNT_ID`;
- `CLOUDFLARE_D1_DATABASE_ID`;
- `CLOUDFLARE_API_TOKEN` com apenas D1 Read e D1 Write para o banco necessário.

IA editorial:

- `AI_PROVIDER=openai`;
- `AI_API_KEY`;
- `AI_MODEL`;
- `AI_BASE_URL=https://api.openai.com/v1`;
- `AI_TIMEOUT_MS=45000`;
- `AI_MAX_RETRIES=2`;
- `AI_DAILY_LIMIT_USD`;
- `AI_DAILY_REQUEST_LIMIT`;
- `AI_INPUT_COST_PER_1M`;
- `AI_OUTPUT_COST_PER_1M`.

As duas tarifas por milhão devem corresponder ao modelo escolhido para que o custo estimado e o limite financeiro sejam corretos.

WordPress:

- `WORDPRESS_BASE_URL`;
- `WORDPRESS_USERNAME`;
- `WORDPRESS_APPLICATION_PASSWORD`.

Automação:

- `CRON_SECRET`, longo, aleatório e sem quebras de linha.

Nenhuma variável sensível pode usar prefixo público (`NEXT_PUBLIC_` ou `VITE_`). Configure as mesmas variáveis no ambiente Production e, quando necessário, em Preview.

## Migration segura do D1

O projeto usa Drizzle e migrations aditivas. A sprint operacional está em `drizzle/0001_chemical_the_stranger.sql`; ela adiciona colunas e tabelas, preserva registros existentes e cadastra duas fontes RSS públicas verificadas.

Processo obrigatório:

1. exporte um backup do D1;
2. aplique a migration em um banco de staging;
3. execute coleta, leitura, edição e publicação mockada;
4. aplique em produção com `npx wrangler d1 migrations apply <DATABASE_ID> --remote --config wrangler.migrations.jsonc`;
5. valide `/api/ready`, cadastre uma fonte e confirme leitura após novo deploy;
6. só depois libere o deployment Vercel para tráfego.

Não use `drizzle-kit push`, `DROP`, reset ou recriação do banco em produção. O runtime não executa alterações destrutivas automaticamente.

## Proteção de acesso

A política privada do Sites não acompanha a Vercel. Ative Deployment Protection antes de expor dados reais. As APIs atuais confiam nessa proteção perimetral; não publique o domínio sem ela.

## Verificação

Antes de promover um commit:

```text
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run build:vercel
```

Depois do deploy, confirme `/api/health`, `/api/ready`, `/api/ai/status`, um teste de feed, uma coleta manual e um draft WordPress. O teste WordPress real deve ser feito somente com um site autorizado e credenciais de Application Password.
