import { readFile, writeFile } from "node:fs/promises";

const outputConfigUrl = new URL("../.vercel/output/config.json", import.meta.url);
const projectConfigUrl = new URL("../vercel.json", import.meta.url);
const [outputConfig, projectConfig] = await Promise.all([
  readFile(outputConfigUrl, "utf8").then(JSON.parse),
  readFile(projectConfigUrl, "utf8").then(JSON.parse),
]);

if (outputConfig.version !== 3) throw new Error("A saída da Vercel precisa usar Build Output API v3.");
if (!outputConfig.framework || outputConfig.framework.name !== "nitro") throw new Error("A saída da Vercel não foi gerada pelo Nitro.");
outputConfig.crons = projectConfig.crons ?? [];
await writeFile(outputConfigUrl, `${JSON.stringify(outputConfig, null, 2)}\n`, "utf8");
