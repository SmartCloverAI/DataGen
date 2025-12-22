import { getCStore } from "@/lib/ratio1/client";
import { userTasksHash } from "@/lib/ratio1/keys";
import { DataGenTask } from "./types";

function normalizeTask(task: DataGenTask): DataGenTask {
  const step =
    task.step ??
    (task.status === "succeeded" || task.status === "failed"
      ? "completed"
      : "schema");
  const schemaStatus =
    task.schemaStatus ??
    (task.status === "queued" ? "pending" : step === "completed" ? "succeeded" : "running");

  return {
    ...task,
    step,
    schemaStatus,
    schemaError: task.schemaError ?? null,
    datasetMode: task.datasetMode ?? false,
    useCustomInference: task.useCustomInference ?? false,
    inferenceBaseUrl: task.inferenceBaseUrl,
    inferencePath: task.inferencePath,
    inferenceModel: task.inferenceModel,
    errors: task.errors ?? [],
  };
}

export async function persistTask(task: DataGenTask) {
  const cstore = getCStore();
  await cstore.hset({
    hkey: userTasksHash(task.owner),
    key: task.id,
    value: JSON.stringify(task),
  });
  return task;
}

export async function getTask(owner: string, taskId: string) {
  const cstore = getCStore();
  const res = await cstore.hget({
    hkey: userTasksHash(owner),
    key: taskId,
  });
  if (!res.success || !res.result) return null;
  try {
    return normalizeTask(JSON.parse(res.result) as DataGenTask);
  } catch {
    return null;
  }
}

export async function listTasks(owner: string): Promise<DataGenTask[]> {
  const cstore = getCStore();
  const res = await cstore.hgetall({ hkey: userTasksHash(owner) });
  if (!res.success || !res.result?.keys) return [];
  const tasks: DataGenTask[] = [];
  for (const key of res.result.keys) {
    const item = await cstore.hget({
      hkey: userTasksHash(owner),
      key,
    });
    if (item.success && item.result) {
      try {
        tasks.push(normalizeTask(JSON.parse(item.result) as DataGenTask));
      } catch {
        // ignore bad entries
      }
    }
  }
  return tasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
