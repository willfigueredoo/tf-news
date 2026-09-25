import { TFNewsPage } from "../../tf-news-page";

export const dynamic = "force-dynamic";

export default async function ReelIdeaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ideaId = Number(id);
  return <TFNewsPage openReelIdeas initialReelIdeaId={Number.isInteger(ideaId) && ideaId > 0 ? ideaId : null} />;
}
