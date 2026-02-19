import { promises as fs } from "fs";
import path from "path";

import { envFlag, readEnv } from "@/lib/env";
import { generateRecord } from "./inference";
import {
  ensurePeerConfig,
  getMaxConcurrentJobs,
  getJobPollSeconds,
  getPeerId,
  getUpdateEveryK,
} from "./peers";
import {
  getJobBase,
  getPeerState,
  listJobsForPeer,
  listPeerStates,
  updateJobBase,
  updatePeerState,
} from "./jobStore";
import { DataGenJobDetails } from "./types";
import { downloadText, uploadText } from "@/lib/ratio1/r1fs";
import { updateMetrics } from "./metrics";
import { INFERENCE_BASE_URL } from "./constants";
import { getActiveProfile, getProfileById, readUserSettings } from "./userSettings";

const DEFAULT_CACHE_DIR = "/_local_cache/datagen";
const ENABLED = !envFlag("DATAGEN_DISABLE_WORKER");

let workerStarted = false;
let workerBusy = false;
let pollHandle: NodeJS.Timeout | null = null;

function isExternalInference(details: DataGenJobDetails): boolean {
  if (typeof details.inference.useExternalApi === "boolean") {
    return details.inference.useExternalApi;
  }
  // Backward compatibility for legacy jobs created before useExternalApi existed.
  return Boolean(details.inference.profileId);
}

function getCacheDir() {
  return readEnv("DATAGEN_LOCAL_CACHE_DIR") ?? DEFAULT_CACHE_DIR;
}

function jobPeerDir(jobId: string, peerId: string) {
  return path.join(getCacheDir(), jobId, peerId);
}

function resultsFilePath(jobId: string, peerId: string) {
  return path.join(jobPeerDir(jobId, peerId), "results.jsonl");
}

function stateFilePath(jobId: string, peerId: string) {
  return path.join(jobPeerDir(jobId, peerId), "state.json");
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function readLocalResults(jobId: string, peerId: string) {
  const filePath = resultsFilePath(jobId, peerId);
  try {
    const data = await fs.readFile(filePath, "utf8");
    const lines = data.split("\n").filter((line) => line.trim().length > 0);
    let ok = 0;
    let failed = 0;
    const errors: Array<{ index: number; message: string }> = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as {
          i: number;
          ok: boolean;
          data?: unknown;
          error?: string;
        };
        if (parsed.ok) {
          ok += 1;
        } else {
          failed += 1;
          errors.push({ index: parsed.i, message: parsed.error ?? "error" });
        }
      } catch {
        // ignore malformed line
      }
    }
    return { total: lines.length, ok, failed, errors };
  } catch {
    return { total: 0, ok: 0, failed: 0, errors: [] as Array<{ index: number; message: string }> };
  }
}

async function appendResult(
  jobId: string,
  peerId: string,
  record: Record<string, unknown>,
) {
  const filePath = resultsFilePath(jobId, peerId);
  await fs.appendFile(filePath, JSON.stringify(record) + "\n", "utf8");
}

async function saveLocalState(jobId: string, peerId: string, data: unknown) {
  await fs.writeFile(stateFilePath(jobId, peerId), JSON.stringify(data, null, 2));
}

async function loadJobDetails(jobId: string, cid: string): Promise<DataGenJobDetails> {
  const payload = await downloadText(cid);
  const details = JSON.parse(payload) as DataGenJobDetails;
  if (!details || details.id !== jobId) {
    throw new Error("Invalid job details payload");
  }
  return details;
}

async function updateTotalsAndStatus(jobId: string) {
  const job = await getJobBase(jobId);
  if (!job) return;
  const peers = await listPeerStates(jobId);
  const totalOk = peers.reduce((sum, peer) => sum + (peer.generatedOk ?? 0), 0);
  const totalFailed = peers.reduce(
    (sum, peer) => sum + (peer.generatedFailed ?? 0),
    0,
  );
  const totalGenerated = totalOk + totalFailed;

  const allComplete = peers.every(
    (peer) =>
      peer.generatedOk + peer.generatedFailed >= peer.assigned &&
      Boolean(peer.resultCid),
  );

  const nextStatus = allComplete ? "succeeded" : job.status;
  const now = new Date().toISOString();
  const updates: Partial<typeof job> = {
    totalOk,
    totalFailed,
    totalGenerated,
    updatedAt: now,
  };

  if (allComplete && job.status !== "succeeded") {
    updates.status = "succeeded";
    updates.jobFinishedAt = now;
    if (job.jobStartedAt) {
      updates.recordsDurationMs =
        new Date(now).getTime() - new Date(job.jobStartedAt).getTime();
    }
  }

  await updateJobBase(jobId, updates);

  if (allComplete && job.status !== "succeeded") {
    await updateMetrics({ activeJobs: -1 });
  }
}

async function runJobForPeer(jobId: string) {
  const peerId = getPeerId();
  const job = await getJobBase(jobId);
  if (!job) return;
  const peerState = await getPeerState(jobId, peerId);
  if (!peerState) return;

  if (peerState.resultCid) return;

  try {
    await ensureDir(jobPeerDir(jobId, peerId));

    const local = await readLocalResults(jobId, peerId);
    const totalGenerated = local.total;
    const rangeStart = peerState.range.start;
    const rangeEnd = peerState.range.end;
    const startIndex = rangeStart + totalGenerated;

    if (totalGenerated > 0) {
      await updatePeerState(jobId, peerId, {
        generatedOk: local.ok,
        generatedFailed: local.failed,
        lastUpdateAt: new Date().toISOString(),
      });
    }

    const details = await loadJobDetails(jobId, job.jobDetailsCid);
    const userSettings = await readUserSettings(job.owner);
    const selectedProfile =
      getProfileById(userSettings, details.inference.profileId) ??
      getActiveProfile(userSettings);
    const useExternalApi = isExternalInference(details);
    const inferenceConfig = {
      baseUrl: useExternalApi
        ? details.inference.baseUrl || INFERENCE_BASE_URL
        : INFERENCE_BASE_URL,
      path: details.inference.path,
      apiKey: useExternalApi ? selectedProfile?.apiKey : undefined,
      model: details.inference.model,
      parameters: details.inference.parameters,
    };

    const now = new Date().toISOString();
    if (!peerState.startedAt) {
      await updatePeerState(jobId, peerId, { startedAt: now });
    }
    if (job.status !== "running") {
      await updateJobBase(jobId, {
        status: "running",
        jobStartedAt: job.jobStartedAt ?? now,
        updatedAt: now,
      });
      await updateMetrics({ activeJobs: 1, lastJobAt: now });
    }

    let generatedOk = local.ok;
    let generatedFailed = local.failed;
    const errors = [...local.errors];
    const updateEvery = getUpdateEveryK();
    let sinceLastUpdate = 0;

    for (let i = startIndex; i < rangeEnd; i += 1) {
      try {
        const { record, failedAttempts } = await generateRecord(
          details.instructions,
          details.schema,
          details.datasetMode ?? false,
          inferenceConfig,
        );
        await appendResult(jobId, peerId, { i, ok: true, data: record });
        generatedOk += 1;
        sinceLastUpdate += 1;
        if (failedAttempts > 0) {
          generatedFailed += failedAttempts;
        }
        await updateMetrics({ totalRecordsGenerated: 1 });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown inference error";
        await appendResult(jobId, peerId, { i, ok: false, error: message });
        generatedFailed += 1;
        errors.push({ index: i, message });
        sinceLastUpdate += 1;
      }

      if (sinceLastUpdate >= updateEvery) {
        sinceLastUpdate = 0;
        const updatedAt = new Date().toISOString();
        await updatePeerState(jobId, peerId, {
          generatedOk,
          generatedFailed,
          lastUpdateAt: updatedAt,
        });
        await updateTotalsAndStatus(jobId);
      }
    }

    const finishedAt = new Date().toISOString();
    const resultsPath = resultsFilePath(jobId, peerId);
    const resultsContent = await fs.readFile(resultsPath, "utf8");
    const resultCid = await uploadText(resultsContent, `${jobId}_${peerId}.jsonl`);
    const errorsCid = await uploadText(
      JSON.stringify(errors, null, 2),
      `${jobId}_${peerId}_errors.json`,
    );

    await updatePeerState(jobId, peerId, {
      generatedOk,
      generatedFailed,
      resultCid,
      errorsCid,
      finishedAt,
      lastUpdateAt: finishedAt,
    });
    await saveLocalState(jobId, peerId, {
      generatedOk,
      generatedFailed,
      resultCid,
      errorsCid,
      finishedAt,
    });

    await updateTotalsAndStatus(jobId);
  } catch (error) {
    const now = new Date().toISOString();
    await updatePeerState(jobId, peerId, {
      finishedAt: now,
      lastUpdateAt: now,
    });
    await updateJobBase(jobId, {
      status: "failed",
      jobFinishedAt: now,
      updatedAt: now,
    });
    await updateMetrics({ failedJobs: 1, activeJobs: -1 });
  }
}

async function pollOnce() {
  if (workerBusy) return;
  const peerId = getPeerId();
  const jobs = await listJobsForPeer(peerId);
  const sorted = jobs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const maxJobs = getMaxConcurrentJobs();

  for (const job of sorted.slice(0, maxJobs)) {
    const state = await getPeerState(job.id, peerId);
    if (!state) continue;
    if (state.generatedOk + state.generatedFailed >= state.assigned && state.resultCid) {
      continue;
    }
    workerBusy = true;
    try {
      await runJobForPeer(job.id);
    } finally {
      workerBusy = false;
    }
    break;
  }
}

export function ensureWorkerStarted() {
  if (workerStarted || !ENABLED) return;
  ensurePeerConfig();
  workerStarted = true;
  const intervalMs = getJobPollSeconds() * 1000;
  pollHandle = setInterval(() => {
    pollOnce().catch((error) => {
      console.error("Job worker poll failed", error);
    });
  }, intervalMs);
  pollOnce().catch((error) => {
    console.error("Job worker initial poll failed", error);
  });
}

export function stopWorker() {
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
  workerStarted = false;
}

export const __jobWorkerTest = {
  runJobForPeer,
};
