export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export type DataGenJobBase = {
  id: string;
  owner: string;
  title: string;
  status: JobStatus;
  totalRecords: number;
  datasetMode?: boolean;
  peers: string[];
  peerCount: number;
  totalGenerated: number;
  totalOk: number;
  totalFailed: number;
  jobDetailsCid: string;
  createdAt: string;
  schemaGeneratedAt: string;
  jobStartedAt?: string;
  jobFinishedAt?: string;
  schemaDurationMs: number;
  recordsDurationMs?: number;
  schemaRefreshes: number;
  updatedAt: string;
};

export type DataGenJobPeerState = {
  peerId: string;
  assigned: number;
  range: { start: number; end: number };
  generatedOk: number;
  generatedFailed: number;
  lastUpdateAt?: string;
  startedAt?: string;
  finishedAt?: string;
  resultCid?: string;
  errorsCid?: string;
  // Legacy in-CStore errors payload; new writes use errorsCid in R1FS.
  errors?: Array<{ index: number; message: string }>;
};

export type DataGenJobDetails = {
  id: string;
  owner: string;
  description: string;
  instructions: string;
  schema: unknown;
  inference: {
    useExternalApi?: boolean;
    profileId?: string;
    baseUrl: string;
    path: string;
    model?: string;
    parameters?: Record<string, unknown>;
  };
  datasetMode?: boolean;
  createdAt: string;
  schemaGeneratedAt: string;
  schemaDurationMs: number;
  schemaRefreshes: number;
  meta?: Record<string, unknown>;
};

export type DataGenUserIndex = {
  username: string;
  email?: string;
  name?: string;
  country?: string;
  createdAt: string;
  jobCount?: number;
};

export type Metrics = {
  totalJobs: number;
  totalRecordsRequested: number;
  totalRecordsGenerated: number;
  activeJobs: number;
  failedJobs: number;
  lastJobAt: string | null;
};
