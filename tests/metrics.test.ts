const store: Record<string, string> = {};

vi.mock("@/lib/ratio1/client", () => ({
  getCStore: () => ({
    async getValue({ key }: { key: string }) {
      if (store[key]) return { success: true, result: store[key] };
      return { success: false, error: "missing" };
    },
    async setValue({
      key,
      value,
    }: {
      key: string;
      value: string;
    }) {
      store[key] = value;
      return { success: true, result: true };
    },
  }),
}));

import { readMetrics, updateMetrics } from "@/lib/datagen/metrics";

describe("metrics helpers", () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) {
      delete store[key];
    }
  });

  it("initializes default metrics when none exist", async () => {
    const metrics = await readMetrics();
    expect(metrics).toEqual({
      totalJobs: 0,
      totalRecordsRequested: 0,
      totalRecordsGenerated: 0,
      activeJobs: 0,
      failedJobs: 0,
      lastJobAt: null,
    });
  });

  it("applies deltas and persists the updated shape", async () => {
    await readMetrics();
    const updated = await updateMetrics({
      totalJobs: 1,
      totalRecordsRequested: 5,
      totalRecordsGenerated: 4,
      activeJobs: 1,
    });

    expect(updated.totalJobs).toBe(1);
    expect(updated.totalRecordsRequested).toBe(5);
    expect(updated.totalRecordsGenerated).toBe(4);
    expect(updated.activeJobs).toBe(1);
  });
});
