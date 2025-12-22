export type TaskStatus = "queued" | "running" | "succeeded" | "failed";

export type TaskStep = "schema" | "records" | "completed";

export type StepStatus = "pending" | "running" | "succeeded" | "failed";

export type DataGenTask = {
  id: string;
  owner: string;
  prompt: string;
  count: number;
  datasetMode?: boolean;
  useCustomInference?: boolean;
  inferenceBaseUrl?: string;
  inferencePath?: string;
  inferenceModel?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  status: TaskStatus;
  step: TaskStep;
  schemaStatus: StepStatus;
  schema?: unknown;
  schemaError?: string | null;
  completed: number;
  failures: number;
  results: Array<unknown>;
  errors?: Array<{ index: number; message: string }>;
};

export type Metrics = {
  totalJobs: number;
  totalRecordsRequested: number;
  totalRecordsGenerated: number;
  activeJobs: number;
  failedJobs: number;
  lastJobAt: string | null;
};
