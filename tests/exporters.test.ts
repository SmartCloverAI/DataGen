import { normalizeResultsForCsv, toCsv } from "@/lib/datagen/exporters";

describe("exporters", () => {
  it("builds headers from mixed records", () => {
    const rows = normalizeResultsForCsv([
      { a: 1, b: "x" },
      { b: "y", c: true },
    ]);
    const csv = toCsv(rows);
    expect(csv.split("\n")[0].split(",").sort()).toEqual(["a", "b", "c"].sort());
  });

  it("wraps primitives in a value column", () => {
    const rows = normalizeResultsForCsv(["one", 2]);
    const csv = toCsv(rows);
    expect(csv).toContain("value");
    expect(csv).toContain("one");
    expect(csv).toContain("2");
  });
});
