import { getCStore } from "@/lib/ratio1/client";
import { METRICS_KEY } from "@/lib/ratio1/keys";
import { Metrics } from "./types";

const DEFAULT_METRICS: Metrics = {
  totalJobs: 0,
  totalRecordsRequested: 0,
  totalRecordsGenerated: 0,
  activeJobs: 0,
  failedJobs: 0,
  lastJobAt: null,
};

function parseMetrics(raw: unknown): Metrics | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Partial<Metrics>;
  if (
    typeof candidate.totalJobs === "number" &&
    typeof candidate.totalRecordsRequested === "number" &&
    typeof candidate.totalRecordsGenerated === "number" &&
    typeof candidate.activeJobs === "number" &&
    typeof candidate.failedJobs === "number"
  ) {
    return {
      totalJobs: candidate.totalJobs,
      totalRecordsRequested: candidate.totalRecordsRequested,
      totalRecordsGenerated: candidate.totalRecordsGenerated,
      activeJobs: candidate.activeJobs,
      failedJobs: candidate.failedJobs,
      lastJobAt: candidate.lastJobAt ?? null,
    };
  }
  return null;
}

export async function readMetrics(): Promise<Metrics> {
  const cstore = getCStore();
  try {
    const existing = await cstore.getValue({ key: METRICS_KEY });
    if (existing.success && existing.result) {
      const parsed = parseMetrics(JSON.parse(existing.result));
      if (parsed) return parsed;
    }
  } catch (err) {
    console.warn("Failed to read metrics, initializing defaults", err);
  }
  await persistMetrics(DEFAULT_METRICS);
  return DEFAULT_METRICS;
}

export async function persistMetrics(metrics: Metrics): Promise<Metrics> {
  const cstore = getCStore();
  await cstore.setValue({
    key: METRICS_KEY,
    value: JSON.stringify(metrics),
  });
  return metrics;
}

export type MetricsDelta = Partial<
  Pick<
    Metrics,
    | "totalJobs"
    | "totalRecordsRequested"
    | "totalRecordsGenerated"
    | "activeJobs"
    | "failedJobs"
  >
> & {
  lastJobAt?: string | null;
};

export async function updateMetrics(delta: MetricsDelta) {
  const current = await readMetrics();
  const next: Metrics = {
    ...current,
    ...delta,
    totalJobs: Math.max(0, current.totalJobs + (delta.totalJobs ?? 0)),
    totalRecordsRequested: Math.max(
      0,
      current.totalRecordsRequested + (delta.totalRecordsRequested ?? 0),
    ),
    totalRecordsGenerated: Math.max(
      0,
      current.totalRecordsGenerated + (delta.totalRecordsGenerated ?? 0),
    ),
    activeJobs: Math.max(0, current.activeJobs + (delta.activeJobs ?? 0)),
    failedJobs: Math.max(0, current.failedJobs + (delta.failedJobs ?? 0)),
    lastJobAt:
      delta.lastJobAt !== undefined ? delta.lastJobAt : current.lastJobAt,
  };
  return persistMetrics(next);
}

export async function getMetricsSafe(): Promise<Metrics | null> {
  try {
    return await readMetrics();
  } catch (err) {
    console.error("Unable to load metrics", err);
    return null;
  }
}
