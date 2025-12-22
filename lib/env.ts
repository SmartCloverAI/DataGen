const FALLBACK_MAP: Record<string, string[]> = {
  R1EN_CSTORE_AUTH_HKEY: ["EE_CSTORE_AUTH_HKEY"],
  R1EN_CSTORE_AUTH_SECRET: ["EE_CSTORE_AUTH_SECRET"],
  R1EN_CSTORE_AUTH_BOOTSTRAP_ADMIN_PWD: ["EE_CSTORE_AUTH_BOOTSTRAP_ADMIN_PW"],
};

function rawEnvValue(key: string): string | undefined {
  const value = process.env[key];
  if (value) return value;
  const fallbacks = FALLBACK_MAP[key] ?? [];
  for (const candidate of fallbacks) {
    const fallbackValue = process.env[candidate];
    if (fallbackValue) return fallbackValue;
  }
  return undefined;
}

function expandEnvValue(
  value: string,
  resolving: Set<string>,
  resolveVar: (key: string) => string | undefined,
): string {
  return value.replace(
    /\$\$|\$\{([^}]+)\}|\$([A-Z0-9_]+)/g,
    (match, braced, simple) => {
      if (match === "$$") return "$";
      const key = braced ?? simple;
      if (!key) return match;
      const resolved = resolveVar(key);
      return resolved ?? "";
    },
  );
}

function resolveEnv(
  key: string,
  resolving: Set<string> = new Set(),
): string | undefined {
  if (resolving.has(key)) {
    throw new Error(
      `Environment variable cycle detected: ${[
        ...resolving,
        key,
      ].join(" -> ")}`,
    );
  }
  resolving.add(key);
  const value = rawEnvValue(key);
  if (value === undefined) {
    resolving.delete(key);
    return undefined;
  }
  const expanded = expandEnvValue(value, resolving, (ref) =>
    resolveEnv(ref, resolving),
  );
  resolving.delete(key);
  return expanded;
}

export function readEnv(key: string): string | undefined {
  return resolveEnv(key);
}

export function requiredEnv(key: string): string {
  const value = readEnv(key);
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export function optionalNumberEnv(key: string, fallback?: number): number | undefined {
  const raw = readEnv(key);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function envFlag(key: string): boolean {
  const raw = readEnv(key);
  if (!raw) return false;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

export function envHostPortUrl(
  hostKey: string,
  portKey?: string,
  protocol = "http",
): string | undefined {
  const host = readEnv(hostKey)?.trim();
  if (!host) return undefined;

  const normalizedHost = host.replace(/\/+$/, "");
  const hasProtocol = /^[a-z]+:\/\//i.test(normalizedHost);
  const base = hasProtocol ? normalizedHost : `${protocol}://${normalizedHost}`;

  if (!portKey) return base;
  const port = readEnv(portKey)?.trim();
  if (!port) return base;

  const hostPortPart = normalizedHost.replace(/^[a-z]+:\/\//i, "");
  const hasPort = /:[0-9]+$/.test(hostPortPart);
  if (hasPort) return base;

  return `${base}:${port}`;
}
