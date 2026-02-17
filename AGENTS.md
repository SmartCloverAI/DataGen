# AGENTS.md — DataGen (instructions for Codex)

This file is the briefing packet for **Codex**, the AI coding agent developing **DataGen**.

DataGen is a **full-stack TypeScript web app + API** for generating synthetic datasets by making **one LLM-style inference call per record**. It uses Ratio1’s **CStore** for shared state and `@ratio1/cstore-auth-ts` for authentication, plus **R1FS** for large artifacts.

---

## 0) Non‑negotiables

- **Use `@ratio1/cstore-auth-ts`** for auth. All actions require auth (UI *and* API).
- **Persist everything** in CStore/R1FS:
  - CStore: users (via cstore-auth-ts), job base records, per‑peer progress, metrics, user indexes.
  - R1FS: job details (schema + instructions) and per‑peer results.
- **Inference API** uses an **OpenAI-like** `/create_chat_completion` endpoint.
- **Constants**: base inference URL, path, and the **system prompt(s)** must be constants.
- **One request per record** (N records = N inference calls).
- UI is **minimal** but must show:
  - progress for each in‑flight record
  - a dashboard of all jobs and their status
  - download completed results as **JSON or CSV**
- **Multi‑instance**: Each replica works its assigned slice **only** via CStore + R1FS (no peer HTTP).

---

## 1) Tech choices (use these unless you have a strong reason)

- **Next.js (App Router)** + TypeScript for one‑repo full‑stack.
- Minimal UI: plain React + basic CSS.
- Node runtime for backend routes (avoid Edge runtime for crypto/session libs).

---

## 2) Repo layout (current)

```
/app
  /(auth)/login/page.tsx
  /(auth)/register/page.tsx           # signup-by-email
  /(app)/page.tsx                     # dashboard UI
  /api
    /auth
      /login/route.ts
      /logout/route.ts
      /me/route.ts
      /register/route.ts
    /metrics/route.ts
    /tasks/route.ts                   # GET list only
    /tasks/schema/route.ts            # POST draft schema
    /tasks/confirm/route.ts           # POST confirm -> create job
    /tasks/[id]/route.ts              # GET job + peers + details
    /tasks/[id]/export/route.ts       # GET download json/csv
    /user
      /settings/route.ts              # GET/POST inference settings (optional)
      /models/route.ts                # POST list models
/components
  /TasksPanel.tsx                     # schema-first flow + job cards
  /LogoutButton.tsx
/lib
  /ratio1
    client.ts                         # edge-sdk client init
    auth.ts                           # CStoreAuth init + helpers
    keys.ts                           # key naming + helpers
    mock.ts                           # in-memory mock mode
    r1fs.ts                           # R1FS helpers
  /auth
    session.ts                        # session cookie/jwt helpers
    requireAuth.ts                    # route guard
    mailer.ts                         # SMTP helper for signup email
  /datagen
    constants.ts                      # INFERENCE_BASE_URL, CREATE_CHAT_COMPLETION_PATH, prompts
    types.ts                          # job + peer + details types
    jobStore.ts                       # CStore persistence
    jobWorker.ts                      # polling worker + local cache
    inference.ts                      # inference call + parsing
    draftToken.ts                     # signed schema draft token
    metrics.ts                        # counters + aggregation
    userIndex.ts                      # user index in CStore
    polling.ts                        # UI polling intervals
    peers.ts                          # peer config + assignment split
    exporters.ts                      # json/csv export
```

---

## 3) Environment variables (local + prod)

### Ratio1 Edge SDK (CStore/R1FS endpoints)
- `EE_CHAINSTORE_API_HOST` + `EE_CHAINSTORE_API_PORT` (fallback: `EE_CHAINSTORE_API_URL`)
- `EE_R1FS_API_HOST` + `EE_R1FS_API_PORT` (fallback: `EE_R1FS_API_URL`)

### cstore-auth-ts (preferred names)
- `R1EN_CSTORE_AUTH_HKEY`
- `R1EN_CSTORE_AUTH_SECRET`
- `R1EN_CSTORE_AUTH_BOOTSTRAP_ADMIN_PWD`

> Legacy `EE_CSTORE_AUTH_*` names are supported; prefer `R1EN_*` in new code.

### DataGen app secrets
- `DATAGEN_SESSION_SECRET` (used to sign cookies/JWTs and draft tokens)
- `DATAGEN_APP_HOST` + `DATAGEN_APP_PORT`
- `DATAGEN_MAX_RECORDS_PER_JOB` (default 200)

### Inference API
- `DATAGEN_INFERENCE_HOST` + `DATAGEN_INFERENCE_PORT`
- `DATAGEN_INFERENCE_BASE_URL` (fallback for host/port)

### Multi-instance / peer identity
- `R1EN_CHAINSTORE_PEERS` (comma-separated peer ids OR JSON array string, e.g. `["peerA","peerB"]`)
- `R1EN_HOST_ADDR` (must match one entry in `R1EN_CHAINSTORE_PEERS`)

### Worker behavior
- `DATAGEN_JOB_POLL_SECONDS` (default 5)
- `DATAGEN_UPDATE_EVERY_K_REQUESTS` (default 5)
- `DATAGEN_MAX_CONCURRENT_JOBS_PER_INSTANCE` (default 1)
- `DATAGEN_LOCAL_CACHE_DIR` (default `/_local_cache/datagen`)

### Signup email
- `DATAGEN_SMTP_HOST`
- `DATAGEN_SMTP_PORT`
- `DATAGEN_SMTP_USER`
- `DATAGEN_SMTP_PASS`
- `DATAGEN_SMTP_FROM`

### Runtime flags / UI knobs
- `DATAGEN_MOCK_CSTORE` — in-memory mock CStore/auth (`admin/admin`, `test_user/testtest`)
- `DATAGEN_MOCK_INFERENCE_API` — in-memory inference stub
- `LOG_INFERENCE_REQUESTS` — logs outgoing inference request (Authorization redacted)
- `DATAGEN_LOG_R1FS_CALLS` — logs R1FS call start/success/error events
- `RETRY_INFERENCE_ON_FAILURE` — retry one extra inference call on failure/parse errors
- `NEXT_PUBLIC_SHOW_FAILURES` — show failure count in UI
- `DATAGEN_MAX_EXTERNAL_API_CONFIGS` — max saved external API profiles per user (default 10)
- `DATAGEN_ACTIVE_POLL_SECONDS` / `DATAGEN_IDLE_POLL_SECONDS` — UI polling intervals (defaults: 10 / 30)
- `NEXT_PUBLIC_DATAGEN_UI_TEST_PRESET` — optional JSON string to auto-fill UI generation form fields for testing

---

## 4) Authentication model (required)

- Username/password login using `CStoreAuth.simple.authenticate(...)`.
- Server issues a **signed session token** as an **HttpOnly cookie**.
- All API routes require auth (including `/api/metrics`).
- UI never talks directly to CStore/R1FS; it only calls our API routes.

---

## 5) Persistence model in CStore + R1FS

### Key naming
- `datagen:metrics` (metrics hash)
- `datagen:jobs` (hash: jobId -> `DataGenJobBase` JSON)
- `datagen:job:{jobId}:peers` (hash: peerId -> `DataGenJobPeerState` JSON)
- `datagen:user:{username}:jobs` (hash: jobId -> summary JSON)
- `datagen:users` (hash: username -> `DataGenUserIndex` JSON)
- `datagen:user:{username}:settings` (JSON)

### Job base (CStore)
```ts
type JobStatus = "queued" | "running" | "succeeded" | "failed";

type DataGenJobBase = {
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
```

### Peer state (CStore)
```ts
type DataGenJobPeerState = {
  peerId: string;
  assigned: number;
  range: { start: number; end: number };
  generatedOk: number;
  generatedFailed: number;
  lastUpdateAt?: string;
  startedAt?: string;
  finishedAt?: string;
  resultCid?: string;
  errors?: Array<{ index: number; message: string }>;
};
```

### Job details (R1FS)
```ts
type DataGenJobDetails = {
  id: string;
  owner: string;
  description: string;
  instructions: string;
  schema: unknown;
  inference: {
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
};
```

### Peer results (R1FS)
- JSONL file: one line per record `{ i, ok, data }` or `{ i, ok:false, error }`.

---

## 6) Inference API integration

### Constants (must exist)
- `INFERENCE_BASE_URL`
- `CREATE_CHAT_COMPLETION_PATH = "/create_chat_completion"`
- `SYSTEM_PROMPT`, `SCHEMA_SYSTEM_PROMPT`, `DATASET_RECORD_SYSTEM_PROMPT`, `DATASET_SCHEMA_SYSTEM_PROMPT`

### One call per record
- Schema draft: single call.
- Record generation: **N calls** (sequential; concurrency later).

### Structured output (`response_format`)
- Schema draft uses `response_format: { "type": "json_object" }` to guarantee valid JSON.
- Record generation uses `response_format: { "type": "json_object", "schema": <JSON Schema> }` when a schema is available.

### Schema validation
- Job confirmation validates the draft schema against the JSON Schema 2020-12 meta-schema and rejects invalid drafts.
- Draft schemas are sanitized before validation to correct obvious mistakes (wrong $schema URL, non-object property values).

---

## 7) API endpoints (current)

### Auth
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `POST /api/auth/register` (name/email/country; emails generated password)

### Schema + Jobs
- `POST /api/tasks/schema` — returns schema + signed draft token
- `POST /api/tasks/confirm` — persists job to CStore/R1FS and returns `{ jobId }`
- `GET /api/tasks` — list jobs for current user
- `GET /api/tasks/[id]` — job base + peer states + job details
- `GET /api/tasks/[id]/export?format=json|csv` — merged export

### Metrics
- `GET /api/metrics` — `{ metrics: { totalJobs, totalRecordsRequested, totalRecordsGenerated, activeJobs, failedJobs, lastJobAt } }`

---

## 8) Worker loop (multi-instance)

- **Singleton polling worker** per instance (`lib/datagen/jobWorker.ts`).
- Polls every `DATAGEN_JOB_POLL_SECONDS`.
- Each peer processes **only its assigned range** from `R1EN_CHAINSTORE_PEERS`.
- Writes progress to CStore every `DATAGEN_UPDATE_EVERY_K_REQUESTS` records.
- Writes results locally (`DATAGEN_LOCAL_CACHE_DIR`) for resume, then uploads JSONL to R1FS when done.
- Updates job totals in CStore and marks `succeeded` when all peers finished.

---

## 9) UI (minimal)

- Schema‑first flow: generate schema → confirm job.
- Job cards (collapsed + expanded) with:
  - status, progress, timestamps, durations
  - description/instructions
  - schema viewer
  - per‑peer stats table
- Download JSON/CSV when job completed.

---

## 10) Commands (expected)

- Install: `npm install`
- Dev: `npm run dev`
- Lint: `npm run lint`
- Test: `npm test`

---

## 11) Guardrails

- Do not store raw passwords anywhere outside `cstore-auth-ts`.
- Do not log secrets, session tokens, or inference API keys.
- Validate user input:
  - record count within `[1, DATAGEN_MAX_RECORDS_PER_JOB]`
  - prompt/instructions non‑empty and size‑limited
- Avoid overwriting job records: update job base and peer states independently.

---

## 14) BUILD-CRITIC protocol (SOTA iterative development + evaluation, 2026 update)

For all non-trivial implementation tasks (especially after `/metrics`), use a **BUILD-CRITIC** loop:

### BUILD phase (small, testable increments)
- Create a short task card with:
  - goal
  - constraints
  - acceptance checks
  - rollback plan
- Break work into stepwise requirement turns (inspired by **SR-Eval**, 2025) instead of one large patch.
- Produce the smallest coherent patch that can be validated end-to-end.

### CRITIC phase (tool + model-assisted critique)
- Run tool-interactive critique first (inspired by **CRITIC**, 2024):
  - type checks
  - lint
  - targeted tests
  - route-level contract checks
  - security/safety checks (auth enforced, secret leaks, input bounds)
- Add structured LLM critique on top of tool output:
  - correctness
  - edge cases
  - maintainability
  - failure handling
  - data integrity in CStore
- Use **selective critique** (inspired by **RefineCoder/ACR**, 2025): spend critique budget where confidence is low, tests fail, or risk is high.

### ITERATE phase
- Apply exactly the fixes justified by critique evidence.
- Re-run the CRITIC phase.
- Keep a compact reflection log (inspired by **Reflexion**, 2023):
  - root cause
  - patch applied
  - prevention note for next iteration

### Stop criteria (must be explicit)
- All acceptance checks pass.
- No auth regressions.
- No persisted-data schema regressions.
- No untriaged high-severity critic findings.

### Evaluation policy (offline + live)
- Always report:
  - `pass@1` on deterministic tests
  - regression count
  - iteration count to green
  - time-to-green
  - cost/latency per successful task
- Maintain two evaluation tracks:
  - **Static benchmark track** (e.g., SWE-bench-style reproducible suites).
  - **Fresh/live track** (inspired by **SWE-bench-Live**, 2025) to reduce contamination and overfitting to stale tasks.
- Prefer contamination-aware evaluation design and periodically refresh holdout tasks.
- When relevant, validate on repository-level, multi-file tasks, not only function-level tasks (aligned with recent SWE-agent benchmarks and SWE-Universe scaling results, 2026).

### Recommended references for this protocol
- Self-Refine (2023): https://arxiv.org/abs/2303.17651
- Reflexion (2023): https://arxiv.org/abs/2303.11366
- CRITIC (2024): https://arxiv.org/abs/2305.11738
- RefineCoder / ACR (2025): https://arxiv.org/abs/2502.09183
- Teaching LMs to Critique via RL / CTRL (2025): https://arxiv.org/abs/2502.03492
- SR-Eval (2025): https://arxiv.org/abs/2509.18808
- SWE-bench (2023/2024): https://arxiv.org/abs/2310.06770
- SWE-bench-Live (2025): https://arxiv.org/abs/2505.23419
- SWE-Universe (2026): https://arxiv.org/abs/2602.02361

---

If any assumption here conflicts with reality (package API differences, env var names, etc.), update this file and align the codebase accordingly.
