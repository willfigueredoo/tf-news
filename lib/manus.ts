import { createHash, createVerify } from "node:crypto";
import { z } from "zod";

export type ManusConfig = {
  apiKey: string;
  baseUrl: string;
  agentProfile: "lite" | "standard" | "max";
  webhookPublicKey: string;
  timeoutMs: number;
};

export const manusResearchSchema = z.object({
  summary: z.string().min(80).max(2_500),
  verifiedFacts: z.array(z.object({
    fact: z.string().min(20).max(900),
    attribution: z.string().min(2).max(240),
    sourceUrl: z.string().url(),
  }).strict()).max(12),
  industrialContext: z.string().min(60).max(2_500),
  operationalImpacts: z.array(z.string().min(15).max(600)).max(8),
  executiveAngles: z.array(z.string().min(15).max(600)).max(8),
  uncertainties: z.array(z.string().min(5).max(600)).max(8),
  consultedSources: z.array(z.object({
    name: z.string().min(2).max(180),
    url: z.string().url(),
    type: z.string().min(2).max(120),
  }).strict()).max(15),
}).strict();

export type ManusResearch = z.infer<typeof manusResearchSchema>;

// Deliberadamente limitado ao subconjunto aceito pelo structured output da Manus API v2.
export const manusResearchJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "verifiedFacts", "industrialContext", "operationalImpacts", "executiveAngles", "uncertainties", "consultedSources"],
  properties: {
    summary: { type: "string" },
    verifiedFacts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["fact", "attribution", "sourceUrl"],
        properties: { fact: { type: "string" }, attribution: { type: "string" }, sourceUrl: { type: "string" } },
      },
    },
    industrialContext: { type: "string" },
    operationalImpacts: { type: "array", items: { type: "string" } },
    executiveAngles: { type: "array", items: { type: "string" } },
    uncertainties: { type: "array", items: { type: "string" } },
    consultedSources: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "url", "type"],
        properties: { name: { type: "string" }, url: { type: "string" }, type: { type: "string" } },
      },
    },
  },
} as const;

export class ManusRequestError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(message: string, status: number, details: unknown = null) {
    super(message);
    this.name = "ManusRequestError";
    this.status = status;
    this.details = details;
  }
}

export function manusConfigured(config: ManusConfig) {
  return Boolean(config.apiKey && /^https:\/\//i.test(config.baseUrl));
}

export function buildManusResearchPrompt(input: {
  title: string;
  excerpt: string;
  content: string;
  sourceName: string;
  originalUrl: string;
  publishedAt: string;
  topics: string[];
  primaryIcp: string;
}) {
  return [
    "Atue como pesquisador técnico para comunicação executiva industrial.",
    "Investigue e cruze o contexto factual da notícia abaixo em fontes públicas confiáveis.",
    "Não escreva o conteúdo final, roteiro, copy ou opinião. O Gemini fará a edição final depois.",
    "Priorize fonte original, órgãos oficiais, dados estatísticos e veículos reconhecidos.",
    "Não invente fatos, números, URLs ou atribuições. Registre incertezas explicitamente.",
    "Busque ângulos úteis nos seis pilares: inteligência de mercado industrial; produtividade e eficiência; tecnologia e futuro da indústria; supply chain e fornecedores; gestão, liderança e negócios; logística sob a perspectiva da indústria.",
    "Retorne apenas o structured output solicitado.",
    JSON.stringify(input),
  ].join("\n\n");
}

export async function createManusResearchTask(
  config: ManusConfig,
  input: Parameters<typeof buildManusResearchPrompt>[0],
  options: { fetchImpl?: typeof fetch; title?: string } = {},
) {
  if (!manusConfigured(config)) throw new Error("O Manus ainda não está configurado.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(`${config.baseUrl}/v2/task.create`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-manus-api-key": config.apiKey },
      body: JSON.stringify({
        message: { content: buildManusResearchPrompt(input) },
        locale: "pt-BR",
        interactive_mode: false,
        hide_in_task_list: true,
        share_visibility: "private",
        agent_profile: config.agentProfile,
        title: options.title ?? `Pesquisa editorial: ${input.title}`.slice(0, 180),
        structured_output_schema: manusResearchJsonSchema,
      }),
      signal: controller.signal,
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new ManusRequestError(manusErrorMessage(payload, response.status), response.status, redact(payload));
    }
    const task = objectValue(payload.task);
    const taskId = stringValue(task.id) || stringValue(payload.task_id) || stringValue(payload.id);
    if (!taskId) throw new ManusRequestError("A Manus API não retornou o identificador da tarefa.", 502, redact(payload));
    return {
      taskId,
      taskUrl: stringValue(task.task_url) || stringValue(task.url) || stringValue(payload.task_url) || null,
      requestId: stringValue(payload.request_id) || response.headers.get("x-request-id"),
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ManusRequestError("A criação da pesquisa no Manus excedeu o tempo limite.", 504);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

let cachedPublicKey: { value: string; expiresAt: number } | null = null;

export async function verifyManusWebhook(
  config: ManusConfig,
  requestUrl: string,
  rawBody: string,
  headers: Headers,
  options: { fetchImpl?: typeof fetch; now?: number } = {},
) {
  const signature = headers.get("x-webhook-signature") ?? "";
  const timestamp = headers.get("x-webhook-timestamp") ?? "";
  const timestampNumber = Number(timestamp);
  const now = options.now ?? Date.now();
  if (!signature || !Number.isFinite(timestampNumber)) return false;
  if (Math.abs(now - timestampNumber * 1_000) > 5 * 60_000) return false;
  const publicKey = config.webhookPublicKey || await loadWebhookPublicKey(config, options.fetchImpl ?? fetch, now);
  const digest = createHash("sha256").update(rawBody).digest("hex");
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${timestamp}.${requestUrl}.${digest}`);
  verifier.end();
  try {
    return verifier.verify(publicKey, signature, "base64");
  } catch {
    return false;
  }
}

async function loadWebhookPublicKey(config: ManusConfig, fetchImpl: typeof fetch, now: number) {
  if (cachedPublicKey && cachedPublicKey.expiresAt > now) return cachedPublicKey.value;
  if (!config.apiKey) throw new Error("MANUS_API_KEY ausente para validar o webhook.");
  const response = await fetchImpl(`${config.baseUrl}/v2/webhook.publicKey`, {
    headers: { "x-manus-api-key": config.apiKey },
  });
  const payload = await readJson(response);
  if (!response.ok) throw new ManusRequestError(manusErrorMessage(payload, response.status), response.status, redact(payload));
  const value = stringValue(payload.public_key) || stringValue(payload.publicKey) || stringValue(objectValue(payload.data).public_key);
  if (!value) throw new ManusRequestError("A Manus API não retornou a chave pública do webhook.", 502);
  cachedPublicKey = { value, expiresAt: now + 60 * 60_000 };
  return value;
}

async function readJson(response: Response) {
  const text = await response.text();
  try { return JSON.parse(text) as Record<string, unknown>; } catch { return { message: text.slice(0, 2_000) }; }
}

function manusErrorMessage(payload: Record<string, unknown>, status: number) {
  const error = objectValue(payload.error);
  return stringValue(error.message) || stringValue(payload.message) || `A Manus API respondeu com status ${status}.`;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key,
    /(key|token|password|authorization|secret)/i.test(key) ? "[REDACTED]" : redact(item),
  ]));
}
