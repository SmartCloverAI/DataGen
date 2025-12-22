import { generateRecord, generateRecordSchema } from "./inference";
import { MAX_RECORDS_PER_JOB } from "./constants";
import { updateMetrics } from "./metrics";
import { DataGenTask } from "./types";
import { persistTask } from "./taskStore";
import { readUserSettings } from "./userSettings";

export function createTask(props: {
  id: string;
  owner: string;
  prompt: string;
  count: number;
  datasetMode?: boolean;
  useCustomInference?: boolean;
  inferenceBaseUrl?: string;
  inferencePath?: string;
  inferenceModel?: string;
}): DataGenTask {
  const now = new Date().toISOString();
  return {
    id: props.id,
    owner: props.owner,
    prompt: props.prompt,
    count: Math.min(Math.max(1, props.count), MAX_RECORDS_PER_JOB),
    datasetMode: props.datasetMode ?? false,
    useCustomInference: props.useCustomInference ?? false,
    inferenceBaseUrl: props.inferenceBaseUrl,
    inferencePath: props.inferencePath,
    inferenceModel: props.inferenceModel,
    createdAt: now,
    status: "queued",
    step: "schema",
    schemaStatus: "pending",
    schema: undefined,
    schemaError: null,
    completed: 0,
    failures: 0,
    results: [],
    errors: [],
  };
}

export async function runTask(task: DataGenTask) {
  const userSettings = await readUserSettings(task.owner);
  const customEnabled =
    task.useCustomInference && (task.inferenceBaseUrl || userSettings.baseUrl);
  const inferenceConfig = customEnabled
    ? {
        baseUrl: task.inferenceBaseUrl ?? userSettings.baseUrl,
        apiKey: userSettings.apiKey,
        path: task.inferencePath ?? userSettings.path,
        model: task.inferenceModel ?? userSettings.model,
      }
    : {};
  const start = new Date().toISOString();
  task.status = "running";
  task.step = "schema";
  task.schemaStatus = "running";
  task.startedAt = start;
  await persistTask(task);
  await updateMetrics({
    totalJobs: 1,
    totalRecordsRequested: task.count,
    activeJobs: 1,
    lastJobAt: start,
  });

  try {
    const { schema, failedAttempts } = await generateRecordSchema(
      task.prompt,
      task.datasetMode,
      inferenceConfig,
    );
    if (failedAttempts > 0) {
      task.failures += failedAttempts;
    }
    task.schema = schema;
    task.schemaStatus = "succeeded";
    task.step = "records";
    await persistTask(task);
  } catch (error: unknown) {
    const failedAttempts =
      typeof (error as any)?.failedAttempts === "number"
        ? (error as any).failedAttempts
        : 1;
    task.failures += Math.max(1, failedAttempts);
    const message =
      error instanceof Error ? error.message : "Unknown schema inference error";
    task.schemaError = message;
    task.schemaStatus = "failed";
    task.status = "failed";
    task.errors?.push({ index: -1, message });
    task.finishedAt = new Date().toISOString();
    await persistTask(task);
    await updateMetrics({
      activeJobs: -1,
      failedJobs: 1,
    });
    return;
  }

  for (let i = 0; i < task.count; i += 1) {
    try {
      const { record, failedAttempts } = await generateRecord(
        task.prompt,
        task.schema,
        task.datasetMode,
        inferenceConfig,
      );
      if (failedAttempts > 0) {
        task.failures += failedAttempts;
      }
      task.results.push(record);
      task.completed += 1;
      await updateMetrics({ totalRecordsGenerated: 1 });
    } catch (error: unknown) {
      const failedAttempts =
        typeof (error as any)?.failedAttempts === "number"
          ? (error as any).failedAttempts
          : 1;
      task.failures += Math.max(1, failedAttempts);
      const message =
        error instanceof Error ? error.message : "Unknown inference error";
      task.errors?.push({ index: i, message });
    }
    await persistTask(task);
  }

  const hadErrors = (task.errors?.length ?? 0) > 0;
  const missingRecords = task.completed < task.count;
  const allSucceeded =
    !hadErrors && !missingRecords && task.schemaStatus === "succeeded";
  task.status = allSucceeded ? "succeeded" : "failed";
  task.step = "completed";
  task.finishedAt = new Date().toISOString();
  await persistTask(task);
  await updateMetrics({
    activeJobs: -1,
    failedJobs: allSucceeded ? 0 : 1,
  });
}

export function startTaskRunner(task: DataGenTask) {
  // Fire-and-forget; do not await to keep API response snappy.
  setImmediate(() => {
    runTask(task).catch((err) => {
      console.error("Task runner failed", err);
    });
  });
}
