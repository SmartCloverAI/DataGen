import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthFromRequest } from "@/lib/auth/requireAuth";
import { readUserSettings } from "@/lib/datagen/userSettings";

export const runtime = "nodejs";

const bodySchema = z.object({
  baseUrl: z.string().url().optional(),
  apiKey: z.string().min(1).optional(),
});

function normalizeBase(base: string) {
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

export async function POST(request: NextRequest) {
  const session = (() => {
    try {
      return requireAuthFromRequest(request);
    } catch {
      return null;
    }
  })();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(payload ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const stored = await readUserSettings(session.username);
  const baseUrl = parsed.data.baseUrl ?? stored.baseUrl;
  const apiKey = parsed.data.apiKey ?? stored.apiKey;

  if (!baseUrl) {
    return NextResponse.json(
      { error: "Inference base URL missing" },
      { status: 400 },
    );
  }

  const modelsUrl = `${normalizeBase(baseUrl)}/models`;
  try {
    const res = await fetch(modelsUrl, {
      method: "GET",
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    });
    if (!res.ok) {
      throw new Error(`Model list failed with status ${res.status}`);
    }
    const data = await res.json();
    const models =
      Array.isArray(data?.data) && data.data.length > 0
        ? data.data
        : Array.isArray(data)
          ? data
          : [];
    return NextResponse.json({ models });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load models";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
