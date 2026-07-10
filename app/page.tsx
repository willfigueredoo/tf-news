import { getChatGPTUser } from "./chatgpt-auth";
import { TFNewsApp } from "./tf-news-app";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();
  const updatedAt = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
  return (
    <TFNewsApp
      userName={user?.displayName ?? "Administrador TF"}
      userEmail={user?.email ?? "ambiente local"}
      initialUpdatedAt={updatedAt}
    />
  );
}
