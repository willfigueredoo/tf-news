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
