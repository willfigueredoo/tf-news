# Inteligência SEO

O módulo cruza três conjuntos de dados persistidos:

- o acervo público da TransFAST;
- notícias reais do Monitoramento;
- artigos de concorrentes cadastrados e confirmados pela TransFAST.

Nenhum concorrente é criado automaticamente. Google Search Console e GA4 permanecem identificados como `not_connected` até que existam integrações reais.

## Sincronização

A propriedade principal é criada pela migration `0006_tough_vargas.sql`. As URLs ficam em `seo_sites` e `seo_site_sources`, editáveis na Visão Geral do módulo.

A ordem de coleta é:

1. WordPress REST API;
2. sitemap;
3. RSS.

O coletor roda somente no servidor, com bloqueio SSRF, timeout, limite de resposta, validação de `Content-Type`, redirects limitados e conteúdo convertido para texto seguro. A sincronização manual usa `/api/seo-intelligence`; a diária usa `/api/cron/seo`, protegida por `CRON_SECRET`.

### Jobs incrementais

Sincronizações do site principal e dos concorrentes são registradas em `seo_sync_jobs`.

- O comando manual apenas cria ou reutiliza um job e responde com HTTP 202.
- Cada worker processa no máximo um pequeno lote, salva o cursor e libera a execução.
- WordPress REST usa paginação por `offset`, campos reduzidos e adapta o lote quando a resposta é grande.
- RSS usa cursor por item.
- Sitemaps usam cursor por arquivo filho e por URL, com poucas páginas processadas por lote.
- Um lease impede dois workers de processarem o mesmo lote.
- Se a função for interrompida, o lease expira e o próximo worker retoma o cursor persistido.
- O cliente mantém o worker ativo enquanto o TF News estiver aberto; o cron diário retoma qualquer job pendente.
- Artigos são deduplicados antes da atualização do cursor, permitindo reprocessar com segurança um lote interrompido.

## TF Authority Score

O score é um índice proprietário, de 0 a 100. Nesta versão:

- `TF News Engine` calcula frequência, regularidade, recência, atualização, profundidade disponível, diversidade, cobertura e lacunas;
- `Gemini Analysis` avalia qualitativamente apenas a amostra fornecida pelo TF News;
- `Google Signals` permanece sem nota enquanto GSC e GA4 não estiverem conectados.

Contribuições ausentes não entram como zero em uma média simples. Os pesos são normalizados somente entre fontes disponíveis. Snapshots são gravados quando métricas ou contribuições mudam.

## Gemini

As operações `seo_authority_summary`, `seo_competitor_analysis` e `seo_opportunity_ranking` reutilizam exclusivamente `getAiConfig()`, `getRuntimeDb()` e `runStructuredAi()`. A chave nunca chega ao frontend. Análises válidas são reutilizadas por hash e validade; falhas, tokens, latência e custo permanecem no log de IA e em `seo_ai_analyses`.

## Oportunidades e fluxo editorial

Os candidatos são gerados deterministicamente a partir dos sinais disponíveis. O Gemini pode priorizar os candidatos, mas não criar fatos ou oportunidades desconectadas dos dados.

As ações de pauta e Kit reutilizam `enqueueEditorialNews()` e `generateEditorialKitForNews()`. Assim, a Fila Editorial, a Biblioteca e a proteção contra duplicidade continuam sendo a única implementação oficial do fluxo.

## Operação segura

Aplicação de banco:

```powershell
npm run db:migrate
npm run db:check
npm run db:check:schema
```

A migration é aditiva. Não use `drizzle-kit push` em produção.
