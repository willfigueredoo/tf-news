# TF News

Plataforma interna de monitoramento de mercado e inteligência editorial da TransFAST.

## Fluxo operacional

RSS/Atom real → coleta → normalização → deduplicação → classificação híbrida → Monitoramento → coerência editorial → briefing por IA → artigo HTML → revisão → draft WordPress → histórico e logs.

## Persistência

O ambiente hospedado usa PostgreSQL gerenciado, acessado por `DATABASE_URL`, com Drizzle ORM e o driver `postgres.js`. A configuração recomendada na Vercel é Neon pelo Marketplace, usando a URL com pooling. Não há binding D1, API REST da Cloudflare nem comando Wrangler no fluxo de execução ou deploy.

As migrations são versionadas em `drizzle/` e executadas somente por comando explícito. O runtime nunca cria, apaga ou altera tabelas automaticamente.

## Desenvolvimento

Requer Node.js 22.13 ou superior e um PostgreSQL acessível. Você pode usar uma branch de desenvolvimento do Neon ou uma instalação PostgreSQL local.

```text
npm ci
copy .env.example .env.local
```

Preencha `DATABASE_URL` em `.env.local`. Na primeira configuração de um banco vazio, carregue as variáveis no terminal e aplique a migration explicitamente:

```text
npm run db:migrate
npm run db:check
npm run dev
```

Validação completa:

```text
npm run lint
npm run typecheck
npm test
npm run build
npm run build:vercel
```

## Segurança operacional

Credenciais ficam apenas no servidor. O WordPress usa Application Password e nunca recebe `status: publish`. O cron falha fechado sem `CRON_SECRET`. Nenhum segredo deve receber prefixo `NEXT_PUBLIC_` ou `VITE_`.

Consulte `DEPLOYMENT.md` para a configuração da Vercel, variáveis, migration e testes reais.

## Limites reais

- IA, WordPress e coleta cron reais dependem das respectivas variáveis no ambiente hospedado;
- o teste automatizado do WordPress é mockado; um draft real só pode ser confirmado com credenciais autorizadas;
- a migration PostgreSQL foi preparada, mas não deve ser aplicada em produção sem aprovação;
- dados que já estejam em outro banco precisam de exportação e importação controladas; a migration estrutural não copia dados entre provedores;
- Vinext e Nitro continuam em versões experimentais/beta e devem ser acompanhados em cada atualização.
