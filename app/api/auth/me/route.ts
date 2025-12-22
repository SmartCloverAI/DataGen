import { NextRequest, NextResponse } from "next/server";

import { requireAuthFromRequest } from "@/lib/auth/requireAuth";

export async function GET(request: NextRequest) {
  try {
    const session = requireAuthFromRequest(request);
    return NextResponse.json(session);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
