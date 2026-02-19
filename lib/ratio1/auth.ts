import { CStoreAuth } from "@ratio1/cstore-auth-ts";

import { envFlag, requiredEnv } from "@/lib/env";
import { getCStore } from "./client";
import { mockAuth } from "./mock";

let authInstance: CStoreAuth | null = null;
let initPromise: Promise<void> | null = null;
const mockMode = envFlag("DATAGEN_MOCK_CSTORE");

function ensureAuthEnv() {
  requiredEnv("R1EN_CSTORE_AUTH_HKEY");
  requiredEnv("R1EN_CSTORE_AUTH_SECRET");
  requiredEnv("R1EN_CSTORE_AUTH_BOOTSTRAP_ADMIN_PWD");
}

function cstoreAuthAdapter() {
  const cstore = getCStore();
  return {
    hget: (hkey: string, key: string) => cstore.hget({ hkey, key }),
    hset: async (hkey: string, key: string, value: string) => {
      await cstore.hset({ hkey, key, value });
    },
    hgetAll: (hkey: string) => cstore.hgetall({ hkey }),
  };
}

export function getAuthClient() {
  if (mockMode) {
    return mockAuth as unknown as CStoreAuth;
  }
  if (!authInstance) {
    ensureAuthEnv();
    authInstance = new CStoreAuth({
      // Adapt edge-sdk cstore client to the interface expected by cstore-auth-ts
      client: cstoreAuthAdapter(),
    });
  }
  return authInstance;
}

export async function ensureAuthInitialized() {
  if (!initPromise) {
    initPromise = getAuthClient().simple.init();
  }
  await initPromise;
  return getAuthClient();
}
