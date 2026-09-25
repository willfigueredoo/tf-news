# Ideias para Reels

O módulo transforma notícias reais do Monitoramento em insumos editoriais para a social media desenvolver conteúdos do CEO da TransFAST. Ele não gera roteiro, cenas, takes, vídeo, imagem nem instruções audiovisuais.

## Jornada

1. o usuário seleciona uma notícia no Monitoramento ou solicita a próxima oportunidade da Visão Executiva;
2. o TF News reutiliza `runStructuredAi()` para produzir título, resumo factual, relevância industrial, abordagem executiva e copy-base;
3. a ideia é persistida com vínculo único à notícia e snapshot da fonte;
4. a social media consulta e copia o material no banco de ideias;
5. apenas status, prioridade e responsável podem ser alterados.

Os textos gerados permanecem bloqueados para preservar rastreabilidade e coerência com a notícia original.

## Pilares

- Inteligência de mercado industrial;
- Produtividade e eficiência;
- Tecnologia e futuro da indústria;
- Supply Chain e gestão de fornecedores;
- Gestão, liderança e negócios;
- Logística sob a perspectiva da indústria.

## Estados

- Nova;
- Em roteiro;
- Em aprovação;
- Aprovada;
- Gravada;
- Arquivada.

A migration `0009_low_bastion.sql` é aditiva: cria apenas as tabelas `reel_ideas` e `reel_idea_sources`, índices e chaves estrangeiras `NO ACTION`.

## Automação editorial

O Banco de Ideias é abastecido em execuções independentes, sempre com uma única chamada ao Gemini por execução:

- até três ideias de atualidade por dia;
- janela principal de sete dias;
- expansão até 14 dias somente quando não houver nenhuma pauta elegível na janela principal;
- uma ideia evergreen por semana, derivada de sinais reais e vinculada às fontes utilizadas;
- bloqueio de concorrência, deduplicação e logs em `job_logs`;
- nenhuma ideia artificial para completar a cota quando não houver material elegível.

As ideias recebem score de relevância de 0 a 100 com seis componentes: relevância industrial, aderência ao pilar, impacto operacional ou logístico, autoridade das fontes, atualidade ou durabilidade e oportunidade editorial. O card diferencia `Atualidade` e `Evergreen` e identifica a origem automática.

A migration `0010_past_young_avengers.sql` adiciona somente colunas de metadados e um índice à tabela `reel_ideas`. Ela não remove nem transforma os kits já existentes.
