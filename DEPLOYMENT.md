# Operação em produção

O TF News mantém Vinext e gera o artefato Vercel pela Build Output API v3 em `.vercel/output/`.

## Criar o PostgreSQL na Vercel

Use um provedor PostgreSQL do Marketplace. A opção recomendada para este projeto é Neon:

1. abra o projeto `tf-news` na Vercel;
2. acesse **Storage** → **Create Database** → **Neon**;
3. crie ou conecte um projeto Neon e selecione Production, Preview e Development conforme sua política;
4. confirme que a integração adicionou uma URL PostgreSQL com pooling;
5. mapeie essa URL para `DATABASE_URL` se o nome fornecido pela integração for diferente;
6. adicione `DATABASE_POOL_MAX=5`;
7. faça `vercel env pull .env.local` apenas em uma máquina autorizada para obter o ambiente local.

Também é possível instalar pelo terminal autenticado com `vercel install neon`. Não cole a URL do banco em comandos, commits ou tickets.

## Configuração do projeto Vercel

- Framework Preset: `Nitro`;
- Install Command: `npm ci --no-audit --no-fund`;
- Build Command: `npm run build:vercel`;
- Output Directory: sem override;
- Node.js: 24.x.

O cron chama `/api/cron/collect` diariamente às 11:00 UTC (08:00 em Brasília), frequência compatível com o plano Hobby atualmente detectado pela Vercel. Para usar duas ou três coletas diárias será necessário migrar o projeto para Pro e alterar conscientemente a expressão. O endpoint exige `Authorization: Bearer $CRON_SECRET`, usa lock no PostgreSQL e registra a execução.

## Variáveis de ambiente

Banco:

- `DATABASE_URL`: URL PostgreSQL com pooling e TLS;
- `DATABASE_POOL_MAX=5`.

Inteligência editorial sob demanda:

```text
AI_PROVIDER=gemini
GEMINI_API_KEY=<segredo criado no Google AI Studio>
AI_MODEL=gemini-3.5-flash
AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta
AI_TIMEOUT_MS=54000
AI_MAX_RETRIES=0
AI_DAILY_LIMIT_USD=5
AI_DAILY_REQUEST_LIMIT=100
AI_INPUT_COST_PER_1M=<tarifa vigente>
AI_OUTPUT_COST_PER_1M=<tarifa vigente>
```

Não exponha `GEMINI_API_KEY` ao cliente. A aplicação envia a chave no header `x-goog-api-key`, valida a resposta com Zod e só chama o Gemini ao clicar em “Gerar Kit Editorial”. O Kit V1 gera somente Blog SEO (500–700 palavras) e WhatsApp Comercial (400–700 caracteres), limita a saída a 1.800 tokens, envia `generationConfig.thinkingConfig.thinkingLevel: "minimal"`, não habilita ferramentas ou grounding, não repete a chamada e usa `AbortController` com teto efetivo de 54 segundos, abaixo dos 60 segundos da função Vercel. Confirme tarifas vigentes antes de preencher os campos de custo.

WordPress:

- `WORDPRESS_BASE_URL`;
- `WORDPRESS_USERNAME`;
- `WORDPRESS_APPLICATION_PASSWORD`.

Automação:

- `CRON_SECRET`: valor longo, aleatório e sem quebras de linha.

Configure os segredos em Production e, somente se necessário, em Preview. Nunca use prefixos públicos.

## Migration segura

A migration inicial PostgreSQL é `drizzle/0000_bumpy_thunderbolt.sql`; ela já foi aplicada e validada no Neon de produção. A migration operacional do Monitoramento é `drizzle/0001_brief_microbe.sql`. A Biblioteca Editorial usa `drizzle/0002_overjoyed_gideon.sql`, aplicada e validada em produção em 15/07/2026, composta somente por `CREATE TABLE`, uma chave estrangeira sem cascata e `CREATE INDEX`. Nenhuma migration futura deve ser executada em produção sem aprovação explícita.

Processo obrigatório:

1. crie uma branch de banco ou banco de staging vazio;
2. associe temporariamente `DATABASE_URL` a esse staging;
3. execute `npm run db:migrate`;
4. execute `npm run db:check`;
5. valide coleta, leitura, edição e WordPress mockado;
6. faça backup/exportação de qualquer banco anterior que contenha dados reais;
7. importe esses dados por processo controlado antes do corte, preservando IDs e sequências;
8. somente após aprovação explícita, aponte `DATABASE_URL` para produção e execute `npm run db:migrate` uma única vez;
9. execute `npm run db:check` e valide `/api/ready`.

Não use `drizzle-kit push`, `DROP`, reset ou recriação do banco. O deploy da Vercel não executa migrations automaticamente.

## Testar leitura e escrita

Com `DATABASE_URL` carregada no terminal autorizado:

```text
npm run db:check
```

O comando abre uma transação, insere um log de diagnóstico, lê o registro e o remove antes de concluir. Depois do deploy, `/api/ready` confirma a consulta do runtime; cadastre uma fonte e recarregue o Monitoramento para validar persistência entre requisições.

## Validar Gemini real

1. crie uma API key no Google AI Studio e defina limites de uso;
2. configure `GEMINI_API_KEY` e as variáveis `AI_*` na Vercel;
3. faça novo deploy;
4. abra `/api/ai/status` e confirme `configured: true`;
5. abra a Notícia do Dia e gere um Kit Editorial;
6. confirme em Histórico/Logs que o provedor, modelo, tokens, latência e custo estimado foram registrados.

Uma decisão determinística não comprova a integração real; o Kit Editorial só conta como validado quando a chamada ao provedor termina com sucesso, passa pelo schema Zod, é salvo na Biblioteca e gera log de uso.

## Testar um draft real no WordPress

1. no usuário editorial do WordPress, crie uma **Application Password** exclusiva;
2. configure `WORDPRESS_BASE_URL`, `WORDPRESS_USERNAME` e `WORDPRESS_APPLICATION_PASSWORD` na Vercel;
3. na aplicação, teste a conexão e carregue categorias/tags;
4. gere, revise e salve um artigo;
5. envie ao WordPress;
6. confirme o ID, a URL de edição e o status `draft` no TF News;
7. abra o rascunho no painel do WordPress e confirme que não foi publicado;
8. tente reenviar o mesmo artigo e confirme que nenhum segundo post foi criado.

## Verificação antes e depois do deploy

```text
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run build:vercel
```

Depois do deploy, confirme `/api/health`, `/api/ready`, `/api/ai/status`, um teste de feed, uma coleta manual, persistência após novo deploy e um draft WordPress autorizado. Mantenha Deployment Protection enquanto as APIs não tiverem autenticação própria.
