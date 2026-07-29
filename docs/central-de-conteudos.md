# Central de Conteúdos

A Central de Conteúdos identifica oportunidades evergreen a partir de dados reais já persistidos no Monitoramento, na Inteligência SEO e no acervo da TransFAST. Google Signals permanece explicitamente desconectado e não recebe pontuação fictícia.

## Fluxo

1. uma coleta RSS ou sincronização competitiva enfileira uma análise;
2. o worker cria um snapshot determinístico dos candidatos;
3. cada execução processa até três candidatos e persiste cursor, lease e resultados;
4. o Gemini valida potencial evergreen, intenção de busca e risco de canibalização pela infraestrutura central `runStructuredAi`;
5. oportunidades aprovadas aparecem na Central;
6. a geração cria uma pauta e reutiliza o pipeline oficial de Kit Editorial;
7. o Kit é salvo atomicamente, recebe a tag `Conteúdo Evergreen` e aparece na Biblioteca.

O frontend nunca aguarda o processamento integral. Jobs interrompidos podem ser retomados após a expiração do lease, sem repetir os lotes concluídos.

## Estados

- `opportunity`: oportunidade disponível;
- `postponed`: adiada pelo usuário;
- `generating`: geração em andamento;
- `in_production`: Kit criado e disponível na Biblioteca;
- `published`: Kit detectado como publicado;
- `failed`: a tentativa falhou sem persistência parcial.

## Operação

O endpoint `/api/content-opportunities` lista oportunidades e controla análise, retomada, adiamento e geração. O cron `/api/cron/content-opportunities` é autenticado por `CRON_SECRET` e roda uma vez ao dia no plano Hobby da Vercel.

A migration `0008_normal_mysterio.sql` é aditiva. Ela cria somente tabelas, índices e chaves estrangeiras; não altera nem remove dados existentes. Nunca use `drizzle-kit push` em produção.

