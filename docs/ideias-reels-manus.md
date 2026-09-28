# Manus + Gemini em Ideias para Reels

O Manus atua como camada opcional de pesquisa factual. O Gemini continua sendo o único editor responsável pelo formato final já usado no Banco de Ideias.

## Fluxo

1. O TF News seleciona uma notícia elegível.
2. Cria um registro em `reel_idea_research_jobs`.
3. A Manus API v2 recebe uma tarefa privada e assíncrona com structured output.
4. O webhook `/api/webhooks/manus` valida assinatura RSA-SHA256 e persiste o levantamento completo.
5. A interface ou os workers diários `/api/cron/manus-reel-ideas` entregam a pesquisa validada ao gerador Gemini existente.
6. A ideia e suas fontes são persistidas atomicamente; o job passa para `completed`.

O webhook não chama o Gemini, para responder rapidamente. O frontend acompanha o job e dispara a finalização em segundo plano sem bloquear a navegação. As automações usam workers diários compatíveis com o plano atual da Vercel. Uma interrupção antes do Gemini não cria conteúdo parcial.

## Variáveis na Vercel

- `MANUS_API_KEY`: chave da Manus API v2.
- `MANUS_API_BASE_URL=https://api.manus.ai`
- `MANUS_AGENT_PROFILE=lite` (aceita `standard` ou `max`).
- `MANUS_TIMEOUT_MS=12000`: limite apenas para criar a tarefa assíncrona.
- `MANUS_WEBHOOK_PUBLIC_KEY`: opcional; se omitida, o runtime consulta `/v2/webhook.publicKey` e mantém cache por uma hora.

Cadastre no Manus o webhook de produção:

`https://tf-news-one.vercel.app/api/webhooks/manus`

Sem `MANUS_API_KEY`, todo o módulo preserva o fluxo direto atual com Gemini.

## Banco

A migration `0011_great_mauler.sql` é somente aditiva: cria a tabela de jobs, duas chaves estrangeiras e índices. Ela não contém `DROP`, `TRUNCATE`, `DELETE`, atualização em massa ou transformação dos dados existentes.
