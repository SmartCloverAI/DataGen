import { readEnv } from "@/lib/env";

const originalEnv: Record<string, string | undefined> = {};
const touched: Set<string> = new Set();

function setEnv(key: string, value: string) {
  if (!touched.has(key)) {
    originalEnv[key] = process.env[key];
    touched.add(key);
  }
  process.env[key] = value;
}

afterEach(() => {
  for (const key of touched) {
    const original = originalEnv[key];
    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }
  touched.clear();
});

describe("environment expansion", () => {
  it("expands referenced variables in place", () => {
    setEnv("HOST_NAME", "localhost");
    setEnv("PORT_NUMBER", "8080");
    setEnv("SERVICE_URL", "http://$HOST_NAME:${PORT_NUMBER}");

    expect(readEnv("SERVICE_URL")).toBe("http://localhost:8080");
  });

  it("supports escaping with $$", () => {
    setEnv("PRICE", "Cost is $$5");
    expect(readEnv("PRICE")).toBe("Cost is $5");
  });

  it("detects cycles between variables", () => {
    setEnv("A", "$B");
    setEnv("B", "$A");

    expect(() => readEnv("A")).toThrow(/cycle/i);
  });
});
