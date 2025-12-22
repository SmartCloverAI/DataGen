import createEdgeSdk from "@ratio1/edge-sdk-ts";

import { envFlag, envHostPortUrl, readEnv } from "@/lib/env";
import { mockCStore } from "./mock";

type RatioClient = ReturnType<typeof createEdgeSdk>;

let cachedClient: RatioClient | null = null;
const mockMode = envFlag("DATAGEN_MOCK_CSTORE");

function buildCStoreUrl() {
  return (
    envHostPortUrl("EE_CHAINSTORE_API_HOST", "EE_CHAINSTORE_API_PORT") ||
    envHostPortUrl("CSTORE_API_HOST", "CSTORE_API_PORT") ||
    readEnv("EE_CHAINSTORE_API_URL")
  );
}

function buildR1fsUrl() {
  return (
    envHostPortUrl("EE_R1FS_API_HOST", "EE_R1FS_API_PORT") ||
    envHostPortUrl("R1FS_API_HOST", "R1FS_API_PORT") ||
    readEnv("EE_R1FS_API_URL")
  );
}

export function getRatioClient(): RatioClient {
  if (mockMode) {
    // @ts-expect-error - mock implements the subset we need
    return { cstore: mockCStore } as RatioClient;
  }
  if (cachedClient) return cachedClient;
  const cstoreUrl = buildCStoreUrl();
  const r1fsUrl = buildR1fsUrl();
  cachedClient = createEdgeSdk({
    verbose: process.env.DATAGEN_DEBUG === "true",
    ...(cstoreUrl ? { cstoreUrl } : {}),
    ...(r1fsUrl ? { r1fsUrl } : {}),
  });
  return cachedClient;
}

export function getCStore() {
  return getRatioClient().cstore;
}
