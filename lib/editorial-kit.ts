import { aiConfigured, runStructuredAi, type AiConfig } from "./ai.ts";
import { editorialKitPayloadSchema, type EditorialKitPayload } from "./operational-schemas.ts";
import type { Database } from "../db/runtime.ts";
import type { EditorialDecision } from "./editorial-intelligence.ts";

export async function generateEditorialKit(db: Database, config: AiConfig, decision: EditorialDecision): Promise<EditorialKitPayload> {
  if (!aiConfigured(config)) throw new Error("Configure o Gemini antes de gerar um Kit Editorial.");
  const response = await runStructuredAi({
    db,
    config,
    operation: "editorial-kit",
    schemaName: "tf_news_editorial_kit",
    schema: editorialKitPayloadSchema,
    system: [
      "Você é o editor-chefe digital do TF News, especializado em logística B2B e inteligência de mercado.",
      "Produza um kit multicanal original em português do Brasil a partir de uma única notícia rastreável.",
      "Não invente dados, falas, datas ou relações causais. Diferencie fato, análise e hipótese.",
      "O blog deve ser útil, executivo e compatível com WordPress; inclua HTML e Markdown equivalentes.",
      "O FAQ schema deve ser JSON-LD válido como string. O prompt de imagem não deve pedir texto ou logotipos.",
      "Não use jargões internos como score, ICP selecionado ou impacto moderado no conteúdo público.",
      "Retorne somente o JSON que obedece ao schema solicitado.",
    ].join(" "),
    user: JSON.stringify({
      decision: {
        title: decision.title,
        source: decision.sourceName,
        url: decision.originalUrl,
        publishedAt: decision.publishedAt,
        excerpt: decision.excerpt,
        availableContent: decision.content.slice(0, 12_000),
        primaryIcp: decision.primaryIcp,
        secondaryIcps: decision.secondaryIcps,
        topics: decision.topics,
        region: decision.region,
        editorialScore: decision.editorialScore,
        opportunity: decision.opportunity,
        commercialImpact: decision.commercialImpact,
        logisticsReason: decision.logisticsReason,
      },
      requiredChannels: ["blogSeo", "whatsapp", "linkedin", "newsletter", "reels", "imagePrompt"],
    }),
    maxOutputTokens: 12_000,
  });
  const sourceIsTraceable = response.data.sources.some((source) => source.url === decision.originalUrl);
  if (!sourceIsTraceable) throw new Error("O Kit Editorial não preservou a fonte original rastreável.");
  return response.data;
}
