import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthFromRequest } from "@/lib/auth/requireAuth";
import {
  readUserSettings,
  saveUserSettings,
  toPublicSettings,
} from "@/lib/datagen/userSettings";

export const runtime = "nodejs";

const settingsSchema = z.object({
  baseUrl: z.string().url().optional(),
  apiKey: z.string().min(1).optional(),
  model: z.string().max(200).optional(),
  path: z.string().max(200).optional(),
});

export async function GET(request: NextRequest) {
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

  const settings = await readUserSettings(session.username);
  return NextResponse.json(toPublicSettings(settings));
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
  const parsed = settingsSchema.safeParse(payload ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const saved = await saveUserSettings(session.username, parsed.data);
  return NextResponse.json(toPublicSettings(saved));
}
