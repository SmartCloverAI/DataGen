import { getCStore } from "@/lib/ratio1/client";
import { userSettingsKey } from "@/lib/ratio1/keys";

export type UserInferenceSettings = {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  path?: string;
};

export type PublicUserInferenceSettings = {
  baseUrl: string | null;
  model: string | null;
  path: string | null;
  hasApiKey: boolean;
};

export async function readUserSettings(
  username: string,
): Promise<UserInferenceSettings> {
  const cstore = getCStore();
  const res = await cstore.getValue({ key: userSettingsKey(username) });
  if (!res.success || !res.result) return {};
  try {
    const parsed = JSON.parse(res.result) as UserInferenceSettings;
    return {
      baseUrl: parsed.baseUrl ?? undefined,
      apiKey: parsed.apiKey ?? undefined,
      model: parsed.model ?? undefined,
      path: parsed.path ?? undefined,
    };
  } catch {
    return {};
  }
}

export async function saveUserSettings(
  username: string,
  settings: UserInferenceSettings,
): Promise<UserInferenceSettings> {
  const existing = await readUserSettings(username);
  const next: UserInferenceSettings = {
    baseUrl: settings.baseUrl ?? existing.baseUrl,
    apiKey: settings.apiKey ?? existing.apiKey,
    model: settings.model ?? existing.model,
    path: settings.path ?? existing.path,
  };
  const cstore = getCStore();
  await cstore.setValue({
    key: userSettingsKey(username),
    value: JSON.stringify(next),
  });
  return next;
}

export function toPublicSettings(
  settings: UserInferenceSettings,
): PublicUserInferenceSettings {
  return {
    baseUrl: settings.baseUrl ?? null,
    model: settings.model ?? null,
    path: settings.path ?? null,
    hasApiKey: Boolean(settings.apiKey),
  };
}
