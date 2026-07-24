import { TFNewsPage } from "../../../tf-news-page";

export const dynamic = "force-dynamic";

export default async function NewCompetitorPage() {
  return <TFNewsPage
    openSeoIntelligence
    initialSeoTab="competitors"
    initialSeoCreatingCompetitor
  />;
}
