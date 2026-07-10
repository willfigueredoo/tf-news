import { getChatGPTUser } from "./chatgpt-auth";
import { TFNewsApp } from "./tf-news-app";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();
  return (
    <TFNewsApp
      userName={user?.displayName ?? "Administrador TF"}
      userEmail={user?.email ?? "ambiente local"}
    />
  );
}
