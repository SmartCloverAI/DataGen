import { generateRecord, generateRecordSchema } from "@/lib/datagen/inference";

describe("inference integration (mocked fetch)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends response_format for schema generation", async () => {
    const fetchMock = vi.fn(async (_url, init: any) => {
      const body = JSON.parse(init.body);
      expect(body.response_format?.type).toBe("json_object");
      expect(body.response_format?.schema).toBeTruthy();
      return {
        ok: true,
        status: 200,
        json: async () => ({
          result: {
            FULL_OUTPUT: [
              {
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        type: "object",
                        properties: { name: { type: "string" } },
                        required: ["name"],
                        additionalProperties: false,
                      }),
                    },
                  },
                ],
              },
            ],
          },
        }),
      } as any;
    });
    globalThis.fetch = fetchMock as any;

    const result = await generateRecordSchema("test schema", false, {
      baseUrl: "http://localhost:1234",
    });

    expect(result.schema).toMatchObject({ type: "object" });
    expect(fetchMock).toHaveBeenCalled();
  });

  it("sends response_format with schema for record generation", async () => {
    const schema = {
      type: "object",
      properties: { id: { type: "string" }, score: { type: "number" } },
      required: ["id", "score"],
      additionalProperties: false,
    };

    const fetchMock = vi.fn(async (_url, init: any) => {
      const body = JSON.parse(init.body);
      expect(body.response_format).toEqual({ type: "json_object", schema });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          result: {
            FULL_OUTPUT: [
              {
                choices: [
                  {
                    message: {
                      content: JSON.stringify({ id: "rec_1", score: 0.5 }),
                    },
                  },
                ],
              },
            ],
          },
        }),
      } as any;
    });
    globalThis.fetch = fetchMock as any;

    const result = await generateRecord("record", schema, false, {
      baseUrl: "http://localhost:1234",
    });

    expect(result.record).toMatchObject({ id: "rec_1" });
    expect(fetchMock).toHaveBeenCalled();
  });

  it("parses schema JSON wrapped in prose", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        result: {
          FULL_OUTPUT: [
            {
              choices: [
                {
                  message: {
                    content: [
                      "I will return the schema below.",
                      '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"name":{"type":"string"}},"required":["name"],"additionalProperties":false}',
                      "Done.",
                    ].join("\n"),
                  },
                },
              ],
            },
          ],
        },
      }),
    }) as any);
    globalThis.fetch = fetchMock as any;

    const result = await generateRecordSchema("test schema", false, {
      baseUrl: "http://localhost:1234",
    });

    expect(result.schema).toMatchObject({
      type: "object",
      properties: { name: { type: "string" } },
    });
  });

  it("parses record JSON from content parts array", async () => {
    const schema = {
      type: "object",
      properties: { id: { type: "string" }, score: { type: "number" } },
      required: ["id", "score"],
      additionalProperties: false,
    };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        result: {
          FULL_OUTPUT: [
            {
              choices: [
                {
                  message: {
                    content: [
                      {
                        type: "text",
                        text: '{"id":"rec_parts","score":0.91}',
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      }),
    }) as any);
    globalThis.fetch = fetchMock as any;

    const result = await generateRecord("record", schema, false, {
      baseUrl: "http://localhost:1234",
    });

    expect(result.record).toMatchObject({ id: "rec_parts", score: 0.91 });
  });
});
