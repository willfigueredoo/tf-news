import vinext from "vinext";
import { defineConfig, loadEnv } from "vite";

const isVercelBuild =
  process.env.VERCEL === "1" || process.env.NITRO_PRESET === "vercel";
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

export default defineConfig(async ({ mode }) => {
  const localEnvironment = loadEnv(mode, process.cwd(), "");
  for (const [key, value] of Object.entries(localEnvironment)) {
    process.env[key] ??= value;
  }

  if (isVercelBuild) {
    process.env.NITRO_PRESET = "vercel";
    const { nitro } = await import("nitro/vite");
    return {
      plugins: [
        vinext(),
        nitro({
          preset: "vercel",
          compatibilityDate: "2026-07-10",
          vercel: { functions: { maxDuration: 60 } },
        }),
      ],
    };
  }

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [vinext()],
  };
});
