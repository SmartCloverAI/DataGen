import { NextRequest, NextResponse } from "next/server";

import { requireAuthFromRequest } from "@/lib/auth/requireAuth";
import { normalizeResultsForCsv, toCsv } from "@/lib/datagen/exporters";
import { getTask, listTasks } from "@/lib/datagen/taskStore";

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
  let task = await getTask(session.username, id);
  if (!task) {
    const tasks = await listTasks(session.username);
    task = tasks.find((t) => t.id === id) ?? null;
  }
  if (!task) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (task.status !== "succeeded" && task.results.length === 0) {
    return NextResponse.json(
      { error: "Task not completed" },
      { status: 400 },
    );
  }

  const format = request.nextUrl.searchParams.get("format") || "json";
  if (format === "csv") {
    const rows = normalizeResultsForCsv(task.results);
    const csv = toCsv(rows);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${task.id}.csv"`,
      },
    });
  }

  return new NextResponse(JSON.stringify(task.results, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${task.id}.json"`,
    },
  });
}
