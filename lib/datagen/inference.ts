import { randomBytes } from "crypto";

import {
  CREATE_CHAT_COMPLETION_PATH,
  INFERENCE_BASE_URL,
  DATASET_RECORD_SYSTEM_PROMPT,
  DATASET_SCHEMA_SYSTEM_PROMPT,
  JSON_SCHEMA_DRAFT_2020_12_META_SCHEMA,
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
  parameters?: Record<string, unknown>;
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

function normalizeJsonCandidate(input: string): string {
  const trimmed = input.trim().replace(/^\uFEFF/, "");
  const noTrailingCommas = trimmed.replace(/,(\s*[}\]])/g, "$1");
  const quotedFractions = noTrailingCommas.replace(
    /:\s*([0-9]+\/[0-9]+[^,\}\]]*)/g,
    (_match, value) => `: "${value.trim()}"`,
  );
  return quotedFractions;
}

function closeDanglingString(input: string): string {
  let inString = false;
  let escape = false;
  for (const char of input) {
    if (escape) {
      escape = false;
      continue;
    }
    if (char === "\\" && inString) {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
    }
  }
  let out = input.trim();
  if (escape) out += "\\";
  if (inString) out += '"';
  return out;
}

function parseWithRepair(input: string): unknown {
  const normalized = normalizeJsonCandidate(input);
  try {
    return JSON.parse(normalized);
  } catch {
    // Try lightweight structural repairs in sequence.
    const repairedClosers = appendMissingClosers(normalized);
    try {
      return JSON.parse(repairedClosers);
    } catch {
      const repairedString = closeDanglingString(repairedClosers);
      try {
        return JSON.parse(repairedString);
      } catch {
        throw new Error("Failed to parse inference response as JSON");
      }
    }
  }
}

function maybeParseNestedJsonString(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return parseWithRepair(trimmed);
    } catch {
      return value;
    }
  }
  return value;
}

function extractBalancedJsonBlocks(input: string): string[] {
  const blocks: string[] = [];
  let inString = false;
  let escape = false;
  let stack: Array<"}" | "]"> = [];
  let start = -1;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
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

    if ((char === "{" || char === "[") && stack.length === 0) {
      start = i;
      stack.push(char === "{" ? "}" : "]");
      continue;
    }
    if (char === "{" || char === "[") {
      stack.push(char === "{" ? "}" : "]");
      continue;
    }
    if (char === "}" || char === "]") {
      const top = stack[stack.length - 1];
      if ((char === "}" && top === "}") || (char === "]" && top === "]")) {
        stack.pop();
        if (stack.length === 0 && start >= 0) {
          blocks.push(input.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }

  return blocks;
}

function collectJsonCandidates(raw: string): string[] {
  const deduped = new Set<string>();
  const push = (value: string | undefined) => {
    if (!value) return;
    const trimmed = value.trim();
    if (trimmed.length === 0) return;
    deduped.add(trimmed);
  };

  const withoutFences = stripCodeFences(raw);
  push(raw);
  push(withoutFences);

  for (const block of extractBalancedJsonBlocks(withoutFences)) {
    push(block);
  }

  const firstObject = withoutFences.indexOf("{");
  const firstArray = withoutFences.indexOf("[");
  const lastObject = withoutFences.lastIndexOf("}");
  const lastArray = withoutFences.lastIndexOf("]");

  if (firstObject !== -1) {
    push(withoutFences.slice(firstObject));
    if (lastObject !== -1 && lastObject > firstObject) {
      push(withoutFences.slice(firstObject, lastObject + 1));
    }
  }
  if (firstArray !== -1) {
    push(withoutFences.slice(firstArray));
    if (lastArray !== -1 && lastArray > firstArray) {
      push(withoutFences.slice(firstArray, lastArray + 1));
    }
  }

  return Array.from(deduped);
}

function parseJsonContent(raw: string): unknown {
  const candidates = collectJsonCandidates(raw);
  for (const candidate of candidates) {
    try {
      const parsed = parseWithRepair(candidate);
      return maybeParseNestedJsonString(parsed);
    } catch {
      // Try next candidate.
    }
  }
  throw new Error("Failed to parse inference response as JSON");
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
    else if (char === "}" && stack[stack.length - 1] === "}") stack.pop();
    else if (char === "]" && stack[stack.length - 1] === "]") stack.pop();
  }

  return stack.reduceRight((acc, closer) => acc + closer, input.trim());
}

function textFromPart(part: unknown): string | null {
  if (typeof part === "string") return part;
  if (!part || typeof part !== "object") return null;

  const candidate = part as Record<string, unknown>;
  if (typeof candidate.text === "string") return candidate.text;
  if (
    candidate.text &&
    typeof candidate.text === "object" &&
    typeof (candidate.text as Record<string, unknown>).value === "string"
  ) {
    return (candidate.text as Record<string, string>).value;
  }
  if (
    candidate.content &&
    typeof candidate.content === "object" &&
    typeof (candidate.content as Record<string, unknown>).text === "string"
  ) {
    return (candidate.content as Record<string, string>).text;
  }
  return null;
}

function extractTextPayload(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const fragments = value
      .map((entry) => textFromPart(entry))
      .filter((entry): entry is string => typeof entry === "string");
    if (fragments.length > 0) {
      return fragments.join("\n").trim();
    }
    return null;
  }
  return textFromPart(value);
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
  if (config.parameters && Object.keys(config.parameters).length > 0) {
    Object.assign(requestBody, config.parameters);
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
        const rawFull = data?.result?.FULL_OUTPUT ?? data;
        const payload = Array.isArray(rawFull) ? rawFull[0] : rawFull;
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
        const contentText = extractTextPayload(content);
        if (typeof contentText === "string" && contentText.trim().length > 0) {
          output = parseJsonContent(contentText);
        } else if (content !== undefined) {
          output = maybeParseNestedJsonString(content);
        } else {
          // Last resort: try TEXT_RESPONSE if provided.
          const textResponse = data?.result?.TEXT_RESPONSE;
          const textCandidate = Array.isArray(textResponse) ? textResponse[0] : textResponse;
          const textPayload = extractTextPayload(textCandidate);
          if (typeof textPayload === "string" && textPayload.trim().length > 0) {
            output = parseJsonContent(textPayload);
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
    {
      role: "user",
      content: [
        prompt,
        "",
        "Return ONLY the JSON Schema object.",
        "Do NOT include example values inside properties.",
        "Every property value must be a JSON Schema object with a type field.",
      ].join("\n"),
    },
  ];

  const { output, failedAttempts } = await callInference(
    messages,
    "schema",
    {
      ...config,
      parameters: {
        temperature: 0.2,
        max_tokens: 1200,
        ...(config.parameters ?? {}),
        response_format: {
          type: "json_object",
          schema: JSON_SCHEMA_DRAFT_2020_12_META_SCHEMA,
        },
      },
    },
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

  let responseFormat: Record<string, unknown> | undefined;
  if (schema && typeof schema === "object" && !Array.isArray(schema)) {
    responseFormat = { type: "json_object", schema };
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
    {
      ...config,
      parameters: {
        ...(config.parameters ?? {}),
        response_format: responseFormat ?? { type: "json_object" },
      },
    },
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
