import { TFNewsPage } from "../../../tf-news-page";

export const dynamic = "force-dynamic";

export default async function SeoCompetitorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const competitorId = Number.parseInt(id, 10);

  return <TFNewsPage
    openSeoIntelligence
    initialSeoTab="competitors"
    initialSeoCompetitorId={Number.isSafeInteger(competitorId) && competitorId > 0 ? competitorId : -1}
  />;
}
