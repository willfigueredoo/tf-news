import type { SeoIntelligenceSnapshot } from "./types.ts";

export const SEO_INTELLIGENCE_MOCK: SeoIntelligenceSnapshot = {
  authority: {
    value: 91,
    weeklyEvolution: 3,
    updatedAt: "2026-07-23T11:30:00.000Z",
    signals: [
      { id: "google-signals", label: "Google Signals", score: 88, weight: 40, description: "Visibilidade, consistência temática e sinais orgânicos." },
      { id: "gemini-ai", label: "Gemini AI", score: 93, weight: 25, description: "Profundidade editorial, clareza e cobertura semântica." },
      { id: "tf-news-engine", label: "TF News Engine", score: 94, weight: 35, description: "Aderência aos ICPs, atualidade e potencial de autoridade." },
    ],
    summary: "O blog apresenta excelente autoridade em logística industrial e agronegócio. A velocidade de publicação e a cobertura dos principais acontecimentos seguem consistentes. Há, porém, uma oportunidade crescente em Logística Farmacêutica, tema no qual transportadoras concorrentes começaram a publicar com maior frequência.",
    insights: [
      { id: "s1", type: "strength", title: "Autoridade setorial", description: "Cobertura consistente de logística industrial, agronegócio e transporte rodoviário." },
      { id: "s2", type: "strength", title: "Ritmo editorial", description: "Cadência recente suficiente para sustentar atualidade e recorrência temática." },
      { id: "s3", type: "strength", title: "Aderência aos ICPs", description: "Conteúdos conectados às principais decisões dos segmentos atendidos." },
      { id: "o1", type: "opportunity", title: "Logística Farmacêutica", description: "Demanda crescente e cobertura ainda limitada no acervo próprio." },
      { id: "o2", type: "opportunity", title: "Torre de Controle", description: "Tema com potencial de busca e espaço para posicionamento técnico." },
      { id: "o3", type: "opportunity", title: "Cabotagem integrada", description: "Possibilidade de conectar eficiência operacional e transporte multimodal." },
    ],
  },
  competitors: [
    { id: "braspress", name: "Braspress", domain: "braspress.com", articlesLast30Days: 8, lastPublishedAt: "2026-07-21T14:00:00.000Z", mainTopics: ["Farmacêutica", "Armazenagem", "Tecnologia"], editorialSummary: "A Braspress concentrou sua produção recente em logística farmacêutica, armazenagem e eficiência operacional, com abordagem predominantemente institucional." },
    { id: "jamef", name: "Jamef", domain: "jamef.com.br", articlesLast30Days: 5, lastPublishedAt: "2026-07-18T10:30:00.000Z", mainTopics: ["E-commerce", "Distribuição", "ESG"], editorialSummary: "A Jamef ampliou conteúdos sobre distribuição para e-commerce e sustentabilidade, mantendo menor profundidade em operações industriais." },
    { id: "patrus", name: "Patrus Transportes", domain: "patrus.com.br", articlesLast30Days: 4, lastPublishedAt: "2026-07-16T09:15:00.000Z", mainTopics: ["Rodoviário", "Segurança", "Sudeste"], editorialSummary: "A Patrus priorizou segurança no transporte rodoviário e cobertura regional, com pouca presença em temas de tecnologia logística." },
    { id: "tora", name: "Tora", domain: "tora.com.br", articlesLast30Days: 3, lastPublishedAt: "2026-07-12T16:45:00.000Z", mainTopics: ["Indústria", "Multimodal", "Mineração"], editorialSummary: "A Tora mantém produção focada em operações industriais, mineração e integração multimodal, com baixa frequência editorial." },
  ],
  competitorArticles: [
    { id: "b1", competitorId: "braspress", title: "Boas práticas no transporte de medicamentos", url: "https://example.com/braspress/medicamentos", publishedAt: "2026-07-21T14:00:00.000Z", topics: ["Farmacêutica", "Compliance"], excerpt: "Cuidados operacionais e regulatórios na movimentação de medicamentos." },
    { id: "b2", competitorId: "braspress", title: "Tecnologia aplicada à armazenagem", url: "https://example.com/braspress/armazenagem", publishedAt: "2026-07-15T12:00:00.000Z", topics: ["Armazenagem", "Tecnologia"], excerpt: "Como monitoramento e automação apoiam a eficiência de centros logísticos." },
    { id: "j1", competitorId: "jamef", title: "Distribuição eficiente para o e-commerce", url: "https://example.com/jamef/ecommerce", publishedAt: "2026-07-18T10:30:00.000Z", topics: ["E-commerce", "Distribuição"], excerpt: "Estratégias para reduzir prazos e ampliar previsibilidade nas entregas." },
    { id: "j2", competitorId: "jamef", title: "ESG no transporte rodoviário", url: "https://example.com/jamef/esg", publishedAt: "2026-07-10T13:00:00.000Z", topics: ["ESG", "Rodoviário"], excerpt: "Iniciativas ambientais aplicadas à gestão de frotas." },
    { id: "p1", competitorId: "patrus", title: "Segurança como prioridade nas rodovias", url: "https://example.com/patrus/seguranca", publishedAt: "2026-07-16T09:15:00.000Z", topics: ["Segurança", "Rodoviário"], excerpt: "Processos de prevenção e controle de risco no transporte." },
    { id: "t1", competitorId: "tora", title: "Integração multimodal para operações industriais", url: "https://example.com/tora/multimodal", publishedAt: "2026-07-12T16:45:00.000Z", topics: ["Multimodal", "Indústria"], excerpt: "Combinação de modais para operações de maior complexidade." },
  ],
  opportunities: [
    { id: "agri-storage", title: "Armazenagem Agrícola", icp: "Agronegócio", priority: "Alta", seoPotential: "Muito alto", confidence: 96, detectedAt: "2026-07-23T10:00:00.000Z", reasons: ["Alta cobertura na mídia", "Baixa cobertura pelos concorrentes", "Alta relevância para o ICP", "Potencial elevado para SEO"], relatedNews: 18, competitorCoverage: "baixa" },
    { id: "pharma-logistics", title: "Logística Farmacêutica", icp: "Indústria Química", priority: "Alta", seoPotential: "Muito alto", confidence: 91, detectedAt: "2026-07-22T15:00:00.000Z", reasons: ["Concorrentes aumentando a cobertura", "Poucos artigos publicados pela TransFAST", "Boa oportunidade de autoridade"], relatedNews: 9, competitorCoverage: "alta" },
    { id: "control-tower", title: "Torre de Controle Logística", icp: "Todos os ICPs", priority: "Alta", seoPotential: "Alto", confidence: 88, detectedAt: "2026-07-21T11:00:00.000Z", reasons: ["Busca recorrente por previsibilidade", "Tema transversal aos ICPs", "Baixa profundidade nos conteúdos existentes"], relatedNews: 12, competitorCoverage: "média" },
    { id: "chemical-safety", title: "Segurança no Transporte Químico", icp: "Indústria Química", priority: "Média", seoPotential: "Alto", confidence: 84, detectedAt: "2026-07-19T13:30:00.000Z", reasons: ["Atualizações regulatórias recentes", "Alta relevância operacional", "Possibilidade de conteúdo perene"], relatedNews: 7, competitorCoverage: "baixa" },
    { id: "steel-cabotage", title: "Cabotagem para a Cadeia do Aço", icp: "Aço", priority: "Média", seoPotential: "Moderado", confidence: 78, detectedAt: "2026-07-15T09:00:00.000Z", reasons: ["Discussão crescente sobre multimodalidade", "Aderência ao ICP de Aço", "Poucos conteúdos comparativos"], relatedNews: 5, competitorCoverage: "baixa" },
  ],
  unexploredTopics: ["Logística Farmacêutica", "Cabotagem", "ESG", "Torre de Controle"],
};
