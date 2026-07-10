# GitHub e Vercel

Este repositório está preparado para ser publicado no GitHub com validação automática de lint, tipos, testes e build.

## GitHub

O repositório local já existe, usa a branch `main` e não possui remoto persistente. Para criar um repositório privado chamado `tf-news` com GitHub CLI:

```powershell
gh auth login
gh repo create tf-news --private --source=. --remote=origin --push
```

Se o repositório for criado pelo site do GitHub, conecte-o assim:

```powershell
git remote add origin https://github.com/<USUARIO_OU_ORG>/tf-news.git
git push -u origin main
```

Nunca inclua tokens na URL do remoto nem confirme arquivos `.env*`, `.dev.vars*`, `.npmrc`, chaves privadas, credenciais JSON ou bancos locais.

## Estado da compatibilidade com Vercel

O frontend é baseado em Next.js, mas o runtime atual é `vinext` para Cloudflare Workers. Banco, autenticação e variáveis usam recursos específicos do Cloudflare/Sites:

- banco Drizzle sobre binding D1 `DB`;
- imports de `cloudflare:workers` nas rotas e no acesso ao banco;
- autenticação por cabeçalhos e rotas fornecidas pelo Sites;
- build gerado como Cloudflare Worker.

Portanto, um deploy direto na Vercel não preserva hoje todas as funcionalidades. Não configure `dist/client` como saída estática: isso desativaria APIs, autenticação, banco e WordPress.

Antes do primeiro deploy Vercel, é necessário autorizar uma etapa separada de migração de infraestrutura:

1. trocar o build `vinext` pelo build Next.js suportado pela Vercel;
2. substituir D1 por um banco acessível pela Vercel, mantendo Drizzle, ou implementar um adaptador seguro;
3. substituir a autenticação privada do Sites por um provedor compatível com Vercel;
4. proteger endpoints mutáveis e o futuro cron no novo ambiente;
5. migrar os dados e validar a integração WordPress em Preview;
6. somente então importar o GitHub na Vercel e promover para Production.

## Variáveis

### Runtime atual no Cloudflare/Sites

- `DB`: binding D1, não é uma string em `.env`.
- `WORDPRESS_BASE_URL`: opcional; necessária para a integração WordPress.
- `WORDPRESS_USERNAME`: opcional; necessária para a integração WordPress.
- `WORDPRESS_APPLICATION_PASSWORD`: segredo opcional; necessária para a integração WordPress.

### Futuro runtime Vercel, após a migração

- `DATABASE_URL`: conexão do banco de produção.
- `APP_URL`: URL canônica da aplicação.
- `AUTH_SECRET`: segredo forte do novo mecanismo de autenticação.
- `WORDPRESS_BASE_URL`: se a integração WordPress permanecer ativa.
- `WORDPRESS_USERNAME`: se a integração WordPress permanecer ativa.
- `WORDPRESS_APPLICATION_PASSWORD`: segredo, se a integração permanecer ativa.
- `CRON_SECRET`: segredo para o endpoint de agendamento quando ele for implementado e protegido.

`AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL` e `ENCRYPTION_KEY` estão reservadas no exemplo, mas não são consumidas pela implementação atual.

## Migrations sem perda de dados

O projeto usa Drizzle, não Prisma. A migration inicial está em `drizzle/0000_huge_sentry.sql`.

Para mudanças futuras:

1. faça backup e teste de restauração antes da migration;
2. altere `db/schema.ts`;
3. gere uma migration versionada com `npm run db:generate`;
4. revise o SQL e rejeite qualquer `DROP`, truncamento ou recriação destrutiva não planejada;
5. aplique primeiro em Preview/Staging;
6. aplique uma única vez em produção com `drizzle-kit migrate` usando uma configuração de produção e credencial injetada pelo ambiente;
7. execute `/api/ready` e testes de leitura/escrita antes de promover a aplicação.

Não use `drizzle-kit push`, reset, drop ou recriação do banco em produção. Para alterações incompatíveis, use o padrão expandir → copiar dados → migrar leitura/escrita → remover somente em uma versão posterior.
