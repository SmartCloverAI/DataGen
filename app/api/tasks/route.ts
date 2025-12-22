import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthFromRequest } from "@/lib/auth/requireAuth";
import { MAX_RECORDS_PER_JOB } from "@/lib/datagen/constants";
import { createTask, startTaskRunner } from "@/lib/datagen/taskRunner";
import { listTasks, persistTask } from "@/lib/datagen/taskStore";

export const runtime = "nodejs";

const createTaskSchema = z.object({
  prompt: z.string().min(1, "Prompt is required").max(4000),
  count: z
    .number()
    .int()
    .min(1)
    .max(MAX_RECORDS_PER_JOB),
  datasetMode: z.boolean().optional(),
  useCustomInference: z.boolean().optional(),
  inferenceBaseUrl: z.string().url().optional(),
  inferencePath: z.string().max(200).optional(),
  inferenceModel: z.string().max(200).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const session = requireAuthFromRequest(request);
    const tasks = await listTasks(session.username);
    return NextResponse.json({ tasks });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
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
  const parsed = createTaskSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  if (parsed.data.useCustomInference && !parsed.data.inferenceBaseUrl) {
    return NextResponse.json(
      { error: "Custom inference requires an inferenceBaseUrl" },
      { status: 400 },
    );
  }
  if (parsed.data.inferencePath && parsed.data.inferencePath.length > 0) {
    // allow relative path only
    if (parsed.data.inferencePath.startsWith("http")) {
      return NextResponse.json(
        { error: "inferencePath should be a relative path, not a full URL" },
        { status: 400 },
      );
    }
  }

  const taskId = `task_${Date.now()}`;
  const task = createTask({
    id: taskId,
    owner: session.username,
    prompt: parsed.data.prompt,
    count: parsed.data.count,
    datasetMode: parsed.data.datasetMode ?? false,
    useCustomInference: parsed.data.useCustomInference ?? false,
    inferenceBaseUrl: parsed.data.inferenceBaseUrl,
    inferencePath: parsed.data.inferencePath,
    inferenceModel: parsed.data.inferenceModel,
  });

  await persistTask(task);
  startTaskRunner(task);

  return NextResponse.json(task, { status: 202 });
}
