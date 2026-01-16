import { randomBytes } from "crypto";

import {
  CREATE_CHAT_COMPLETION_PATH,
  INFERENCE_BASE_URL,
  DATASET_RECORD_SYSTEM_PROMPT,
  DATASET_SCHEMA_SYSTEM_PROMPT,
  SCHEMA_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
} from "./constants";
import { envFlag } from "@/lib/env";

type InferenceResult = {
  output: unknown;
  failedAttempts: number;
};

type RecordResult = { record: unknown; failedAttempts: number };
type SchemaResult = { schema: unknown; failedAttempts: number };
type InferenceConfig = {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  path?: string;
};

const mockInferenceMode = envFlag("DATAGEN_MOCK_INFERENCE_API");
const logInferenceRequests = envFlag("LOG_INFERENCE_REQUESTS");
const retryInferenceOnFailure = envFlag("RETRY_INFERENCE_ON_FAILURE");

function randomSentence() {
  const words = [
    "alpha",
    "brisk",
    "cobalt",
    "delta",
    "ember",
    "fable",
    "glow",
    "harbor",
    "ivory",
    "jolt",
    "keystone",
    "lumen",
    "motive",
    "nova",
    "orbit",
    "pulse",
    "quartz",
    "ripple",
    "solstice",
    "tandem",
    "uplink",
    "vector",
    "whisper",
    "zenith",
  ];
  const len = 6 + Math.floor(Math.random() * 6);
  const sentence = [];
  for (let i = 0; i < len; i += 1) {
    sentence.push(words[Math.floor(Math.random() * words.length)]);
  }
  const text = sentence.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1) + ".";
}

function randomRecord(): Record<string, unknown> {
  const keyCount = 2 + Math.floor(Math.random() * 4); // 2-5 keys
  const record: Record<string, unknown> = {};
  for (let i = 0; i < keyCount; i += 1) {
    const key = `field_${i + 1}`;
    const isNumeric = Math.random() > 0.5;
    record[key] = isNumeric
      ? Math.round(Math.random() * 1000) / 10
      : randomSentence();
  }
  record.id = randomBytes(4).toString("hex");
  record.generatedAt = new Date().toISOString();
  return record;
}

function randomSchema() {
  const fieldCount = 3 + Math.floor(Math.random() * 3);
  const fields = [];
  const typePool = ["string", "number", "boolean", "date"];
  for (let i = 0; i < fieldCount; i += 1) {
    fields.push({
      name: `field_${i + 1}`,
      type: typePool[Math.floor(Math.random() * typePool.length)],
      description: randomSentence(),
    });
  }
  return {
    title: "SyntheticRecord",
    description: "Mock schema generated locally (DATAGEN_MOCK_INFERENCE_API=true)",
    fields,
  };
}

function valueForType(type: string) {
  const normalized = type.toLowerCase();
  if (normalized.includes("int") || normalized === "number") {
    return Math.round(Math.random() * 10000) / 10;
  }
  if (normalized === "boolean" || normalized === "bool") {
    return Math.random() > 0.5;
  }
  if (normalized.includes("date") || normalized.includes("time")) {
    return new Date(Date.now() - Math.random() * 1000 * 60 * 60 * 24 * 30).toISOString();
  }
  return randomSentence();
}

function recordFromSchema(schema: unknown): Record<string, unknown> | null {
  if (!schema || typeof schema !== "object") return null;
  const maybeFields = (schema as any).fields;
  const record: Record<string, unknown> = {};

  if (Array.isArray(maybeFields)) {
    for (const field of maybeFields) {
      if (!field?.name) continue;
      const type =
        typeof field.type === "string"
          ? field.type
          : typeof field.datatype === "string"
            ? field.datatype
            : "string";
      record[field.name] = valueForType(type);
    }
    if (Object.keys(record).length > 0) return record;
  }

  const properties = (schema as any).properties;
  if (properties && typeof properties === "object") {
    for (const [name, def] of Object.entries(properties)) {
      const type =
        typeof (def as any)?.type === "string"
          ? (def as any).type
          : "string";
      record[name] = valueForType(type);
    }
    if (Object.keys(record).length > 0) return record;
  }

  return null;
}

function looksLikeSchema(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  if (Array.isArray(obj.fields) && obj.fields.length > 0) return true;
  if (obj.properties && typeof obj.properties === "object") return true;
  if (typeof obj.type === "string" && obj.type.toLowerCase() === "object") return true;
  return false;
}

function buildUrl(baseOverride?: string, pathOverride?: string) {
  const baseCandidate = baseOverride ?? INFERENCE_BASE_URL;
  if (!baseCandidate) return null;
  const base = baseCandidate.endsWith("/")
    ? baseCandidate.slice(0, -1)
    : baseCandidate;
  const path =
    pathOverride && pathOverride.trim().length > 0
      ? pathOverride.startsWith("/")
        ? pathOverride
        : `/${pathOverride}`
      : CREATE_CHAT_COMPLETION_PATH;
  return `${base}${path}`;
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  // Remove leading fence (and optional language) and trailing fence.
  const withoutStart = trimmed.replace(/^```[a-zA-Z0-9_-]*\s*/, "");
  const endIndex = withoutStart.lastIndexOf("```");
  if (endIndex === -1) return withoutStart.trim();
  return withoutStart.slice(0, endIndex).trim();
}

function parseJsonContent(raw: string): unknown {
  const withoutFences = stripCodeFences(raw);
  const start = withoutFences.indexOf("{");
  const end = withoutFences.lastIndexOf("}");
  const candidate =
    start !== -1 && end !== -1 && end > start
      ? withoutFences.slice(start, end + 1)
      : withoutFences;
  const trimmed = candidate.trim();
  const noTrailingCommas = trimmed.replace(/,(\s*[}\]])/g, "$1");
  const quotedFractions = noTrailingCommas.replace(
    /:\s*([0-9]+\/[0-9]+[^,\}\]]*)/g,
    (_match, value) => `: "${value.trim()}"`,
  );
  return parseWithRepair(quotedFractions);
}

function parseWithRepair(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    // Try a lightweight structural repair: append missing closing brackets/braces.
    const repaired = appendMissingClosers(input);
    try {
      return JSON.parse(repaired);
    } catch (error) {
      throw new Error("Failed to parse inference response as JSON");
    }
  }
}

function appendMissingClosers(input: string): string {
  const stack: Array<"}" | "]"> = [];
  let inString = false;
  let escape = false;

  for (const char of input) {
    if (escape) {
      escape = false;
      continue;
    }
    if (char === "\\") {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === "{") stack.push("}");
    else if (char === "[") stack.push("]");
    else if ((char === "}" || char === "]") && stack.length > 0) stack.pop();
  }

  return stack.reduceRight((acc, closer) => acc + closer, input.trim());
}

type InferenceMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

async function callInference(
  messages: InferenceMessage[],
  label: "schema" | "record",
  config: InferenceConfig = {},
): Promise<InferenceResult> {
  const url = buildUrl(config.baseUrl, config.path);
  if (!url) {
    return {
      output: {
        note: `stubbed ${label} (DATAGEN_INFERENCE_HOST/PORT not set)`,
        messages,
      },
      failedAttempts: 0,
    };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  const requestBody: Record<string, unknown> = { messages };
  if (config.model) {
    requestBody.model = config.model;
  }

  const maxAttempts = retryInferenceOnFailure ? 2 : 1;
  let lastError: Error | null = null;
  let failedAttempts = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
      });

      if (logInferenceRequests) {
        const redactedHeaders = { ...headers };
        const redactedBody = { ...requestBody };
        if (redactedBody.authorization) {
          redactedBody.authorization = "[redacted]";
        }
        console.log(
          `[datagen] ${label} inference request (attempt ${attempt}/${maxAttempts})\n`,
          `url=${url}\n`,
          `headers=${JSON.stringify(redactedHeaders)}\n`,
          `body=${JSON.stringify(redactedBody, null, 2)}`,
        );
      }

      if (!response.ok) {
        throw new Error(`Inference call failed with status ${response.status}`);
      }

      const data = await response.json();
      // Prefer FULL_OUTPUT (OpenAI-like) for storage; fall back to top-level.
      let output: unknown;
      let parseError: Error | null = null;
      let resultErrorMessage: string | null = null;
      try {
        const payload = data?.result?.FULL_OUTPUT ?? data;
        const result = data?.result;
        const statusValue =
          typeof result?.status === "string" ? result.status.toLowerCase() : null;
        if (result?.error) {
          resultErrorMessage = String(result.error);
        } else if (
          statusValue &&
          !["ok", "success", "succeeded", "200"].includes(statusValue)
        ) {
          resultErrorMessage = statusValue;
        }

        const content =
          payload?.choices?.[0]?.message?.content ??
          payload?.message?.content ??
          payload?.content ??
          payload;
        if (typeof content === "string") {
          output = parseJsonContent(content);
        } else if (content !== undefined) {
          output = content;
        } else {
          // Last resort: try TEXT_RESPONSE if provided.
          const textResponse = data?.result?.TEXT_RESPONSE;
          if (typeof textResponse === "string") {
            output = parseJsonContent(textResponse);
          } else {
            throw new Error("Inference response missing content");
          }
        }
      } catch (error) {
        parseError =
          error instanceof Error
            ? error
            : new Error("Unknown error parsing inference response");
      }
      if (resultErrorMessage) {
        parseError =
          parseError ??
          new Error(`Inference result error: ${resultErrorMessage}`);
      }

      if (logInferenceRequests) {
        const safeOutput = parseError || output === undefined ? undefined : output;
        const parsedOutputString = (() => {
          try {
            return safeOutput !== undefined
              ? JSON.stringify(safeOutput, null, 2)
              : undefined;
          } catch {
            return "[unstringifiable output]";
          }
        })();
        console.log(
          `[datagen] ${label} inference response (attempt ${attempt}/${maxAttempts})\n`,
          `status=${response.status}\n`,
          `raw=${JSON.stringify(data, null, 2)}\n`,
          `parsed=${parsedOutputString ?? "[none]"}\n`,
          parseError ? `error=${parseError.message}` : "",
        );
      }

      if (parseError) {
        throw parseError;
      }

      return { output, failedAttempts };
    } catch (error) {
      failedAttempts += 1;
      lastError =
        error instanceof Error
          ? error
          : new Error("Unknown inference error");
      if (attempt >= maxAttempts) break;
      // Loop to retry.
    }
  }

  if (lastError && typeof (lastError as any).failedAttempts !== "number") {
    (lastError as any).failedAttempts = failedAttempts;
  }
  throw lastError ?? new Error("Inference call failed");
}

export async function generateRecordSchema(
  prompt: string,
  datasetMode = false,
  config: InferenceConfig = {},
): Promise<SchemaResult> {
  if (mockInferenceMode) {
    return { schema: randomSchema(), failedAttempts: 0 };
  }

  const messages: InferenceMessage[] = [
    {
      role: "system",
      content: datasetMode ? DATASET_SCHEMA_SYSTEM_PROMPT : SCHEMA_SYSTEM_PROMPT,
    },
    { role: "user", content: prompt },
  ];

  const { output, failedAttempts } = await callInference(
    messages,
    "schema",
    config,
  );
  return { schema: output, failedAttempts };
}

export async function generateRecord(
  prompt: string,
  schema?: unknown,
  datasetMode = false,
  config: InferenceConfig = {},
): Promise<RecordResult> {
  if (mockInferenceMode) {
    const record = recordFromSchema(schema) ?? randomRecord();
    return {
      record,
      failedAttempts: 0,
    };
  }

  const messages: InferenceMessage[] = [
    {
      role: "system",
      content: datasetMode ? DATASET_RECORD_SYSTEM_PROMPT : SYSTEM_PROMPT,
    },
    { role: "user", content: prompt },
  ];

  if (schema) {
    messages.push({
      role: "user",
      content: [
        "Generate one example record that CONFORMS to this JSON schema.",
        "Return ONLY the record JSON object (never the schema).",
        JSON.stringify(schema),
      ].join("\n"),
    });
  }

  const { output, failedAttempts } = await callInference(
    messages,
    "record",
    config,
  );
  let record = output;

  if (looksLikeSchema(record)) {
    const coerced = recordFromSchema(schema ?? record);
    record = coerced ?? record;
  }

  if (schema && record && typeof record === "object" && !Array.isArray(record)) {
    // Ensure all schema-defined fields exist; fill missing with synthetic values.
    const schemaBased = recordFromSchema(schema);
    if (schemaBased) {
      record = { ...schemaBased, ...record };
    }
  }

  return { record, failedAttempts };
}
