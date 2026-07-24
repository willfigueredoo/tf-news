# TF News

Plataforma interna de monitoramento de mercado e inteligência editorial da TransFAST.

## TF News V2

RSS/Atom real → coleta → classificação → decisão editorial → Notícia do Dia → Kit Editorial V1 (Blog SEO + WhatsApp Comercial) → Biblioteca. A IA só é chamada quando um usuário solicita o kit; o ranking funciona por regras transparentes sobre dados persistidos. WordPress permanece uma saída opcional. Os módulos legados Radar e Insights estão arquivados e fora da navegação ativa, com o código analítico preservado para eventual reativação.

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
- o provedor editorial atual é Gemini e o modelo é definido por `AI_MODEL` no runtime;
- a geração V1 usa no máximo 1.800 tokens de saída, `thinkingLevel: minimal` e timeout total efetivo de até 54 segundos;
- somente respostas `429` ou de alta demanda podem repetir: espera 5 segundos, tenta novamente, espera 10 segundos e faz a terceira e última tentativa;
- respostas estruturais passam por normalização segura de títulos, descrições, slug, resumo, WhatsApp, tags e palavras-chave antes da validação Zod final; campos ausentes e HTML inválido continuam bloqueando a persistência;
- a experiência V2.1 orienta o Blog para 450–550 palavras, torna o WhatsApp mais natural e reúne revisão, pré-visualização, cópia e organização do Kit na Biblioteca; favoritos e itens fixados são preferências locais e não exigem alteração do banco;
- LinkedIn, Newsletter, Reels e geração de imagem estão fora do fluxo ativo e permanecem no backlog futuro;
- a migration aditiva `0002_overjoyed_gideon.sql` da Biblioteca Editorial foi aplicada e validada no Neon de produção em 15/07/2026;
- o teste automatizado do WordPress é mockado; um draft real só pode ser confirmado com credenciais autorizadas;
- as migrations `0000`, `0001` e `0002` já foram aplicadas e validadas em produção; migrations posteriores continuam exigindo aprovação explícita;
- dados que já estejam em outro banco precisam de exportação e importação controladas; a migration estrutural não copia dados entre provedores;
- Vinext e Nitro continuam em versões experimentais/beta e devem ser acompanhados em cada atualização.
