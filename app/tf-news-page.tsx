import { getChatGPTUser } from "./chatgpt-auth";
import type { SeoTab } from "./seo-intelligence/seo-intelligence";
import { TFNewsApp } from "./tf-news-app";

export async function TFNewsPage({
  initialSeoTab = "overview",
  initialSeoCompetitorId = null,
  initialSeoCreatingCompetitor = false,
  openSeoIntelligence = false,
  openContentCenter = false,
}: {
  initialSeoTab?: SeoTab;
  initialSeoCompetitorId?: number | null;
  initialSeoCreatingCompetitor?: boolean;
  openSeoIntelligence?: boolean;
  openContentCenter?: boolean;
} = {}) {
  const user = await getChatGPTUser();
  const updatedAt = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Sao_Paulo",
  }).format(new Date());

  return <TFNewsApp
    userName={user?.displayName ?? "Administrador TF"}
    userEmail={user?.email ?? "ambiente local"}
    initialUpdatedAt={updatedAt}
    initialView={openContentCenter ? "Central de Conteúdos" : openSeoIntelligence ? "Inteligência SEO" : "Visão Executiva"}
    initialSeoTab={initialSeoTab}
    initialSeoCompetitorId={initialSeoCompetitorId}
    initialSeoCreatingCompetitor={initialSeoCreatingCompetitor}
  />;
}
