# AGENTS.md — DataGen (instructions for Codex)

This file is the briefing packet for **Codex**, the AI coding agent developing **DataGen**.

DataGen is a **full-stack TypeScript web app + API** for generating synthetic datasets by making **one LLM-style inference call per record**. It uses Ratio1’s **CStore** for persistence and `@ratio1/cstore-auth-ts` for authentication.

---

## 0) Non‑negotiables

- **Use `@ratio1/cstore-auth-ts`** for auth. All actions require auth (UI *and* API).
- **Persist everything** in CStore: users (via cstore-auth-ts), jobs, job progress, results, and metrics.
- **Inference API** uses an **OpenAI-like** `/create_chat_completion` endpoint.
- **Constants**: base inference URL, path, and the **system prompt** must be constants.
- **One request per record** (N records = N inference calls).
- UI is **minimal** but must show:
  - progress for each in-flight record
  - a dashboard of all jobs and their status
  - download completed results as **JSON or CSV**
- **Start here:** implement **only `/metrics`** first (auth-protected), with persisted counters.
  - After that, implement the job system + UI.

---

## 1) Tech choices (use these unless you have a strong reason)

- **Next.js (App Router)** + TypeScript for one-repo full-stack.
- Minimal UI: plain React + basic CSS (or Tailwind if you prefer, but keep it minimal).
- Node runtime for backend routes (avoid Edge runtime for crypto/session libs).

---

## 2) Repo layout (target)

```
/app
  /(auth)/login/page.tsx
  /(app)/page.tsx                     # dashboard UI
  /api
    /auth
      /login/route.ts
      /logout/route.ts
      /me/route.ts
    /metrics/route.ts                 # FIRST deliverable
    /tasks/route.ts                   # POST create, GET list
    /tasks/[id]/route.ts              # GET status/results
    /tasks/[id]/export/route.ts       # GET download json/csv
/lib
  /ratio1
    client.ts                         # edge-sdk client init
    auth.ts                           # CStoreAuth init + helpers
    keys.ts                           # key naming + helpers
  /auth
    session.ts                        # session cookie/jwt helpers
    requireAuth.ts                    # route guard
  /datagen
    constants.ts                      # INFERENCE_BASE_URL, CREATE_CHAT_COMPLETION_PATH, SYSTEM_PROMPT
    types.ts
    taskRunner.ts                     # job execution loop (server-side)
    exporters.ts                      # json/csv export
    metrics.ts                        # counters + aggregation
```

You can adjust exact structure, but keep the separation: **auth**, **ratio1 client**, **datagen core**, **UI**.

---

## 3) Environment variables (local + prod)

### Ratio1 Edge SDK (CStore/R1FS endpoints)
These come from the container environment in production, but for local dev you must set them:
- `EE_CHAINSTORE_API_HOST` + `EE_CHAINSTORE_API_PORT`
- `EE_R1FS_API_HOST` + `EE_R1FS_API_PORT` (optional for MVP if not using R1FS yet)

### cstore-auth-ts (preferred names)
- `R1EN_CSTORE_AUTH_HKEY` (e.g. `auth:default`)
- `R1EN_CSTORE_AUTH_SECRET` (pepper; long random string)
- `R1EN_CSTORE_AUTH_BOOTSTRAP_ADMIN_PWD` (bootstrap admin password)

> cstore-auth-ts also accepts legacy `EE_CSTORE_AUTH_*` names; prefer the `R1EN_*` names in new code.

### DataGen app secrets
- `DATAGEN_SESSION_SECRET` (used to sign cookies/JWTs)
- `DATAGEN_APP_HOST` + `DATAGEN_APP_PORT` (for redirects / cookie domain decisions)
- `DATAGEN_MAX_RECORDS_PER_JOB` (default 200)

### Inference API
- `DATAGEN_INFERENCE_HOST` + `DATAGEN_INFERENCE_PORT`
- `DATAGEN_INFERENCE_API_KEY` (if needed by your inference gateway)

---

## 4) Authentication model (required)

### What you must build
- Username/password login using `CStoreAuth.simple.authenticate(...)`.
- Server issues a **signed session token** as an **HttpOnly cookie**.
- All API routes require auth (including `/api/metrics`).
- The UI never talks directly to CStore; it only calls our API routes.

### Recommended implementation
- Implement `requireAuth(req)` that:
  1. reads cookie `datagen_session`
  2. validates signature + expiry
  3. returns `{ username, role }`
- In future, allow optional `Authorization: Bearer <token>` for non-browser API clients.

---

## 5) Persistence model in CStore

### Key naming
Use a consistent prefix:
- `datagen:metrics` (hash of counters)
- `datagen:user:{username}:tasks` (hash: taskId -> JSON)
- `datagen:task:{taskId}` (JSON doc) OR store full doc in the per-user hash only

**Important:** CStore stores values as JSON strings; always `JSON.stringify` on write and `JSON.parse` on read.

### Task record shape (MVP)
```ts
type TaskStatus = "queued" | "running" | "succeeded" | "failed";

type DataGenTask = {
  id: string;
  owner: string;
  prompt: string;
  count: number;

  createdAt: string;
  startedAt?: string;
  finishedAt?: string;

  status: TaskStatus;

  completed: number;          // 0..count
  failures: number;
  results: Array<unknown>;    // one item per record (keep order)
  errors?: Array<{ index: number; message: string }>;
};
```

---

## 6) Inference API integration (core behavior)

### Constants (must exist)
- `INFERENCE_BASE_URL` (derived from `DATAGEN_INFERENCE_HOST` + `DATAGEN_INFERENCE_PORT`, fallback to `DATAGEN_INFERENCE_BASE_URL`)
- `CREATE_CHAT_COMPLETION_PATH = "/create_chat_completion"`
- `SYSTEM_PROMPT` (strict; must instruct model to output exactly one record)

### Request shape
Use a ChatCompletions-like payload:
- system message = `SYSTEM_PROMPT`
- user message = user’s description
- The response should be parsed into a single “record” object.

### One call per record
If user requests N records, perform N calls (sequential first; later add concurrency limit).

### Progress
After each record finishes:
- append result (or error)
- increment `completed`
- persist task
- update metrics counters

---

## 7) UI requirements (minimal)

### Dashboard page
- Form: [Prompt textarea] + [Count input] + [Generate button]
- Table of tasks: created time, prompt summary, status, progress bar, download options

### Progress behavior
- Poll `GET /api/tasks` every ~1–2 seconds (or `GET /api/tasks/[id]` if you implement per-task polling).
- Display `completed / count` and a simple progress bar.

### Downloads
- For completed tasks, allow user to pick JSON or CSV and trigger download via:
  - `GET /api/tasks/[id]/export?format=json|csv`

---

## 8) API endpoints (target)

### First deliverable
- `GET /api/metrics` (auth required)
  - Returns:
    - totalJobs
    - totalRecordsRequested
    - totalRecordsGenerated
    - activeJobs
    - failedJobs
    - lastJobAt

Persist metrics in `datagen:metrics` so it survives restarts.

### Next endpoints (after /metrics)
- `POST /api/tasks` create a job
- `GET /api/tasks` list jobs for current user
- `GET /api/tasks/[id]` get details/status/results
- `GET /api/tasks/[id]/export` download json/csv
- Auth routes:
  - `POST /api/auth/login`
  - `POST /api/auth/logout`
  - `GET /api/auth/me`

---

## 9) Job execution strategy (practical guidance)

Next.js API routes are request/response; long-running work must not block the request for minutes.

For MVP you can do:
- `POST /api/tasks`:
  - create + persist task with status `queued`
  - **trigger an in-process async runner** (fire-and-forget) to execute the job
  - return task id immediately

Later hardening:
- introduce a worker process (separate `node` process) that consumes queued tasks from CStore.
- add a lease/lock per task to prevent double execution across replicas.

---

## 10) Quality bar (definition of done)

### For `/metrics` (Phase 1)
- Auth enforced (no auth => 401)
- Reads/writes metrics in CStore (not in-memory)
- Returns JSON with stable field names
- Includes unit test(s) for auth guard and response shape

### For end-to-end (Phase 2–3)
- Jobs persist and survive refresh
- Progress updates live in UI
- Downloads produce correct JSON/CSV
- All routes are auth-protected
- No secrets are exposed to the browser bundle

---

## 11) Commands (expected)

- Install: `pnpm install`
- Dev: `pnpm dev`
- Lint: `pnpm lint`
- Test: `pnpm test`

If you choose npm instead, keep scripts equivalent.

---

## 12) Implementation notes / guardrails

- Do not store raw passwords anywhere outside `cstore-auth-ts`.
- Do not log secrets, session tokens, or inference API keys.
- Validate user input:
  - `count` must be integer within `[1, DATAGEN_MAX_RECORDS_PER_JOB]`
  - prompt must be non-empty and size-limited
- Rate-limit task creation per user (even a simple in-memory limiter for MVP).

---

## 13) Suggested work plan for Codex

1. **Bootstrap project** (Next.js TS, lint/test setup).
2. **Integrate Ratio1** (`@ratio1/edge-sdk-ts`) + verify CStore connectivity.
3. **Integrate cstore-auth-ts** and implement login/logout/me + session cookie.
4. Implement **`/api/metrics`** with persisted counters (Phase 1 complete).
5. Implement tasks storage model + `/api/tasks` endpoints.
6. Implement task runner that calls inference endpoint N times and persists progress.
7. Build minimal UI dashboard consuming the API routes.
8. Implement export endpoint (JSON/CSV).
9. Add tests for auth + core datagen logic.

---

If any assumption here conflicts with reality (package API differences, env var names, etc.), update this file and align the codebase accordingly.
