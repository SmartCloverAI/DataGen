import { randomBytes } from "crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthFromRequest } from "@/lib/auth/requireAuth";
import { parseDraftToken } from "@/lib/datagen/draftToken";
import { ensurePeerConfig, splitAssignments } from "@/lib/datagen/peers";
import {
  addJobToUser,
  createJobBase,
  setPeerState,
} from "@/lib/datagen/jobStore";
import { DataGenJobDetails } from "@/lib/datagen/types";
import { uploadJson } from "@/lib/ratio1/r1fs";
import { CREATE_CHAT_COMPLETION_PATH, INFERENCE_BASE_URL } from "@/lib/datagen/constants";
import { updateMetrics } from "@/lib/datagen/metrics";
import { ensureWorkerStarted } from "@/lib/datagen/jobWorker";
import { sanitizeSchema, validateJsonSchema } from "@/lib/datagen/schemaValidation";
import { validateExternalBaseUrl } from "@/lib/security/urlValidation";
import {
  getActiveProfile,
  getProfileById,
  readUserSettings,
} from "@/lib/datagen/userSettings";

export const runtime = "nodejs";

const bodySchema = z.object({
  draftToken: z.string().min(1),
  useExternalApi: z.boolean().optional(),
  profileId: z.string().optional(),
  inferenceBaseUrl: z.string().url().optional(),
  inferencePath: z.string().max(200).optional(),
  inferenceModel: z.string().max(200).optional(),
  inferenceParams: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: NextRequest) {
  const session = (() => {
    try {
      return requireAuthFromRequest(request);
    } catch {
      return null;
    }
  })();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const draft = parseDraftToken(parsed.data.draftToken);
  if (!draft) {
    return NextResponse.json({ error: "Invalid or expired draft" }, { status: 400 });
  }

  const sanitized = sanitizeSchema(draft.schema);
  if (sanitized.warnings.length > 0) {
    console.warn("[datagen] schema sanitized", sanitized.warnings);
  }
  const validation = validateJsonSchema(sanitized.schema);
  if (!validation.valid) {
    return NextResponse.json(
      {
        error: "Invalid schema",
        details: validation.errors,
        warnings: sanitized.warnings,
      },
      { status: 400 },
    );
  }

  const { peers } = ensurePeerConfig();
  const now = new Date().toISOString();
  const jobId = `job_${Date.now()}_${randomBytes(3).toString("hex")}`;
  const assignments = splitAssignments(draft.totalRecords, peers);

  const useExternalApi =
    parsed.data.useExternalApi ??
    Boolean(
      draft.profileId ||
        draft.inferenceBaseUrl ||
        draft.inferencePath ||
        draft.inferenceModel,
    );
  const userSettings = await readUserSettings(session.username);
  const selectedProfile = useExternalApi
    ? getProfileById(userSettings, parsed.data.profileId) ??
      getActiveProfile(userSettings)
    : null;
  const baseUrl = useExternalApi
    ? parsed.data.inferenceBaseUrl ??
      selectedProfile?.baseUrl ??
      draft.inferenceBaseUrl
    : undefined;
  const path = useExternalApi
    ? parsed.data.inferencePath ??
      selectedProfile?.path ??
      draft.inferencePath
    : undefined;
  const model = useExternalApi
    ? parsed.data.inferenceModel ??
      selectedProfile?.model ??
      draft.inferenceModel
    : undefined;
  const params = useExternalApi
    ? parsed.data.inferenceParams ?? draft.inferenceParams
    : undefined;
  if (useExternalApi && baseUrl) {
    const urlValidation = validateExternalBaseUrl(baseUrl);
    if (!urlValidation.ok) {
      return NextResponse.json(
        { error: urlValidation.error ?? "Inference base URL is not allowed" },
        { status: 400 },
      );
    }
  }

  const details: DataGenJobDetails = {
    id: jobId,
    owner: session.username,
    description: draft.description,
    instructions: draft.instructions,
    schema: sanitized.schema,
    inference: {
      useExternalApi,
      profileId: useExternalApi ? selectedProfile?.id : undefined,
      baseUrl: baseUrl ?? INFERENCE_BASE_URL,
      path: path ?? CREATE_CHAT_COMPLETION_PATH,
      model,
      parameters: params,
    },
    datasetMode: draft.datasetMode,
    createdAt: now,
    schemaGeneratedAt: draft.schemaGeneratedAt,
    schemaDurationMs: draft.schemaDurationMs,
    schemaRefreshes: draft.schemaRefreshes,
  };

  const jobDetailsCid = await uploadJson(details, `${jobId}_details.json`);

  const jobBase = {
    id: jobId,
    owner: session.username,
    title: draft.title,
    status: "queued" as const,
    totalRecords: draft.totalRecords,
    datasetMode: draft.datasetMode,
    peers,
    peerCount: peers.length,
    totalGenerated: 0,
    totalOk: 0,
    totalFailed: 0,
    jobDetailsCid,
    createdAt: now,
    schemaGeneratedAt: draft.schemaGeneratedAt,
    schemaDurationMs: draft.schemaDurationMs,
    schemaRefreshes: draft.schemaRefreshes,
    updatedAt: now,
  };

  await createJobBase(jobBase);
  await addJobToUser(session.username, {
    id: jobId,
    title: jobBase.title,
    status: jobBase.status,
    createdAt: now,
    updatedAt: now,
  });

  for (const assignment of assignments) {
    await setPeerState(jobId, assignment.peerId, {
      peerId: assignment.peerId,
      assigned: assignment.assigned,
      range: assignment.range,
      generatedOk: 0,
      generatedFailed: 0,
    });
  }

  await updateMetrics({
    totalJobs: 1,
    totalRecordsRequested: draft.totalRecords,
    lastJobAt: now,
  });

  ensureWorkerStarted();

  return NextResponse.json({ jobId });
}
