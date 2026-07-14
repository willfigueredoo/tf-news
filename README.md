# TF News

Plataforma interna de monitoramento de mercado e inteligência editorial da TransFAST.

## Fluxo operacional

RSS/Atom real → coleta → normalização → deduplicação → classificação híbrida → Monitoramento → coerência editorial → briefing por IA → artigo HTML → revisão → draft WordPress → histórico e logs.

## Capacidades

- teste e cadastro de feeds reais, com timeout, retry, status e continuidade após falhas;
- captura de título, URL, GUID, data, fonte, resumo e conteúdo disponível;
- deduplicação por URL canônica, GUID por fonte, título normalizado e hash de conteúdo;
- classificação determinística e, quando configurada, refinamento por IA validado com Zod;
- filtros por ICP, fonte, data, relevância, tema e impacto;
- seleção simples/múltipla, fonte original, ajuste manual de ICP, relevância e descarte;
- bloqueio padrão de notícias desconectadas, com sugestão de grupos;
- briefing e artigo somente com IA real configurada;
- HTML sanitizado e compatível com WordPress, com H2, H3, listas e fontes rastreáveis;
- WordPress REST API com teste, categorias, tags e criação exclusiva como `draft`;
- bloqueio de envio duplicado por banco, lock e recuperação por slug;
- coleta agendada diariamente no plano Hobby da Vercel, com segredo, lock, retries e logs; o mesmo endpoint suporta três execuções por dia no plano Pro;
- D1 persistente, Drizzle migrations e adaptador server-only para a Vercel.

## Desenvolvimento

Requer Node.js 22.13 ou superior. Copie `.env.example` para `.env.local`, preencha somente valores locais e execute:

```text
npm ci
npm run db:migrate:local
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

Credenciais ficam apenas no servidor. O WordPress usa Application Password e nunca recebe `status: publish`. O cron falha fechado sem `CRON_SECRET`. A Vercel deve permanecer sob Deployment Protection enquanto não houver autenticação própria das APIs.

Consulte `DEPLOYMENT.md` para variáveis, migrations e checklist de produção.

## Limites reais

- IA, WordPress real e coleta cron em produção dependem das respectivas variáveis no ambiente hospedado;
- o teste automatizado do WordPress é mockado; um draft real só pode ser confirmado com credenciais autorizadas;
- feeds XML fora dos padrões RSS/Atom comuns podem exigir parser específico;
- o D1 via Vercel usa a API HTTP da Cloudflare e tem mais latência que o binding direto no Worker;
- Vinext e Nitro continuam em versões experimentais/beta e devem ser acompanhados em cada atualização.
