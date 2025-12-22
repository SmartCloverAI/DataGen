import { NextRequest, NextResponse } from "next/server";

import { requireAuthFromRequest } from "@/lib/auth/requireAuth";
import { readMetrics } from "@/lib/datagen/metrics";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    requireAuthFromRequest(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const metrics = await readMetrics();
    return NextResponse.json({ metrics });
  } catch (error) {
    console.error("Failed to read metrics", error);
    return NextResponse.json(
      { error: "Failed to read metrics" },
      { status: 500 },
    );
  }
}
