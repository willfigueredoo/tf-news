import { readFile } from "node:fs/promises";

const outputConfigUrl = new URL("../.vercel/output/config.json", import.meta.url);
const outputConfig = await readFile(outputConfigUrl, "utf8").then(JSON.parse);

if (outputConfig.version !== 3) throw new Error("A saída da Vercel precisa usar Build Output API v3.");
if (!outputConfig.framework || outputConfig.framework.name !== "nitro") throw new Error("A saída da Vercel não foi gerada pelo Nitro.");
if (Array.isArray(outputConfig.crons) && outputConfig.crons.length > 0) {
  throw new Error("O cron deve existir somente no vercel.json para evitar duplicação no deploy.");
}
