import { NextRequest, NextResponse } from "next/server";

import { requireAuthFromRequest } from "@/lib/auth/requireAuth";
import { getTask } from "@/lib/datagen/taskStore";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: { id: string } } | { params: Promise<{ id: string }> },
) {
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

  const { id } = await (context as any).params;
  const task = await getTask(session.username, id);
  if (!task) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(task);
}
