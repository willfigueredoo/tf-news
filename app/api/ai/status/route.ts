import { aiConfigured } from "../../../../lib/ai";
import { getAiConfig } from "../../../../lib/runtime-config";

export async function GET() {
  const config = getAiConfig();
  return Response.json({ configured: aiConfigured(config), provider: config.provider || null, model: config.model || null, dailyCostLimitUsd: config.dailyCostLimitUsd, dailyRequestLimit: config.dailyRequestLimit, costTrackingConfigured: config.inputCostPerMillion > 0 && config.outputCostPerMillion > 0 });
}
