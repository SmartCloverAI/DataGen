# DataGen Update Plan — Multi‑Instance + CStore/R1FS Jobs + Signup-by-Email

This document refines the requested specifications into an implementation-ready plan for Codex.

Source of truth for current architecture: **AGENTS.md** fileciteturn1file0

---

## 0) Goal (what changes)

DataGen becomes a **multi-instance** application where **multiple identical app replicas** collaborate on generating one synthetic dataset job by coordinating **only** through:

- **CStore**: lightweight shared job state + progress counters
- **R1FS**: heavy/large job artifacts (schema + instructions + per-peer results)

Each instance:
- talks to its **own local inference API** (same request shape as today) fileciteturn1file4
- runs a **polling worker loop** to pick up its assigned slice of each job
- caches generated inference results **locally** to allow resume after crash/restart

> Important: Jobs are persisted to CStore/R1FS **only after** schema is confirmed by the user.

---

## 1) High-level architecture

### 1.1 Request/Control plane (API routes)
- **Schema draft** (single inference call) is generated synchronously in an API route, returned to the user for confirmation/regeneration.
- **Job confirm** writes the job to CStore (metadata) and R1FS (heavy details), and returns a `jobId`.

### 1.2 Data plane (worker loop per instance)
- Each instance runs a **single-worker** loop (1 job at a time, as per spec) that:
  - periodically scans CStore for jobs where it is assigned work
  - generates records (1 inference per record)
  - updates progress in CStore every `DATAGEN_UPDATE_EVERY_K_REQUESTS` calls
  - writes partial results to **local cache** for resume
  - uploads final peer result to R1FS once finished, then stores its result CID in CStore

### 1.3 No direct peer comms
- No HTTP calls between DataGen instances.
- “Coordination” = write/read to/from CStore and R1FS only.

---

## 2) Environment variables (additions)

Keep the existing vars in AGENTS.md fileciteturn1file2 and add:

### 2.1 Multi-instance / peer identity
- `R1EN_CHAINSTORE_PEERS` *(required)*
  - A delimited list of peer identifiers (e.g., comma-separated).
  - Used to split `totalRecords` across peers.
- `R1EN_HOST_ADDR` *(required)*
  - The current instance’s peer id (must match one entry in `R1EN_CHAINSTORE_PEERS`).
  - If missing, fail fast at startup.

> Reason: A DataGen “instance” needs a stable identity to know which slice it owns.

### 2.2 Worker behavior
- `DATAGEN_JOB_POLL_SECONDS` *(default: 5)* — how often to poll CStore for new work
- `DATAGEN_UPDATE_EVERY_K_REQUESTS` *(default: 5)* — update CStore progress every K inferences
- `DATAGEN_MAX_CONCURRENT_JOBS_PER_INSTANCE` *(default: 1)* — keep at 1 for now (spec), but allow future lift.

### 2.3 Local cache/resume
- `DATAGEN_LOCAL_CACHE_DIR` *(default: `/_local_cache/datagen`)*
  - Should be on a persistent volume in containerized deployments.
  - DataGen writes job/peer progress + partial results here.

---

## 3) Updated job lifecycle (refined)

### 3.1 Phases
Because jobs are only persisted **after schema confirmation**, the stored job can skip “draft” states:

- `queued` — stored and ready; some peers may not have started
- `running` — at least one peer started generating records
- `succeeded` — all peers finished and uploaded results to R1FS
- `failed` — fatal error that prevents completion (see failure rules)

We’ll also track **step** and **sub-status** for UI:

- `step`: `"records"` (schema already done/confirmed at persistence time)
- `schema`: stored as confirmed, plus metrics about schema time and refresh count

### 3.2 Failure rules (practical)
- Record-level failures should **not necessarily fail the whole job**.
- Each peer stores:
  - `generatedOk` count
  - `generatedFailed` count
  - `errors[]` with indices/messages (bounded, e.g. max 100)
- Job status becomes `failed` only if:
  - a peer cannot continue (e.g., repeated inference failures beyond retry policy), **or**
  - R1FS upload fails permanently, **or**
  - schema/details CID missing/invalid.

---

## 4) CStore data model (refined for safe concurrent updates)

**Constraint:** “Only update fields of the existing job record.”  
**Reality:** With multiple peers updating progress concurrently, we must avoid a single monolithic JSON document that gets overwritten.

**Solution:** Store the job as:
- a *base job record* (rarely updated) + 
- *per-peer progress/result records* (high churn), each updated independently.

This keeps writes conflict-free and still satisfies “update fields” (we update only the specific fields/records, not delete/recreate keys).

### 4.1 Key naming (new/updated)
Keep existing prefix convention fileciteturn1file3 and add:

- **Jobs table**
  - `datagen:jobs` (hash)  
    - field: `{jobId}`  
    - value: JSON string of `DataGenJobBase`
- **Per-job peer table**
  - `datagen:job:{jobId}:peers` (hash)  
    - field: `{peerId}`  
    - value: JSON string of `DataGenJobPeerState`
- **Users table (job lists)**
  - `datagen:users` (hash)  
    - field: `{username}`  
    - value: JSON string of `DataGenUserIndex`
  - `datagen:user:{username}:jobs` (hash OR JSON array under a single key)
    - Minimal: hash field `{jobId}` -> `{"createdAt": "...", "title": "...", "status": "..."}`
    - This becomes the “list of job ids” required by spec.

> Note: `datagen:user:{username}:tasks` remains legacy; new code should prefer `...:jobs`.

### 4.2 Types

#### 4.2.1 Job base (stored in `datagen:jobs`)
```ts
type JobStatus = "queued" | "running" | "succeeded" | "failed";

type DataGenJobBase = {
  id: string;
  owner: string;                 // username
  title: string;

  status: JobStatus;

  totalRecords: number;          // requested
  datasetMode?: boolean;

  // peer config snapshot used for splitting at creation time
  peers: string[];               // from R1EN_CHAINSTORE_PEERS
  peerCount: number;

  // lightweight totals for UI (derived, updated by peers)
  totalGenerated: number;        // sum of peers.generatedOk + generatedFailed
  totalOk: number;
  totalFailed: number;

  // R1FS: heavy job definition stored once after schema confirmation
  jobDetailsCid: string;         // R1FS CID (schema, instructions, params, etc.)

  // timestamps
  createdAt: string;             // confirm time
  schemaGeneratedAt: string;     // time the confirmed schema was produced
  jobStartedAt?: string;         // first peer start
  jobFinishedAt?: string;        // all peers done

  // timing/metrics
  schemaDurationMs: number;
  recordsDurationMs?: number;    // job-level (set when finished)
  schemaRefreshes: number;

  // optional: last update timestamp for UI ordering
  updatedAt: string;
};
```

#### 4.2.2 Peer state (stored in `datagen:job:{id}:peers`)
```ts
type DataGenJobPeerState = {
  peerId: string;

  // assignment
  assigned: number;
  range: { start: number; end: number }; // [start, end) global record indices

  // progress
  generatedOk: number;
  generatedFailed: number;
  lastUpdateAt?: string;

  // lifecycle timestamps
  startedAt?: string;
  finishedAt?: string;

  // result artifact (only set after completion)
  resultCid?: string;            // R1FS CID for this peer’s results

  // bounded error info
  errors?: Array<{ index: number; message: string }>;
};
```

#### 4.2.3 Users table entries
```ts
type DataGenUserIndex = {
  username: string;
  email?: string;
  name?: string;
  country?: string;
  createdAt: string;
  jobCount?: number;
};
```

### 4.3 “Equal split” algorithm (initial behavior)
At confirm time, compute equal assignment across peers listed in `R1EN_CHAINSTORE_PEERS`:

- `base = floor(total / n)`
- `remainder = total % n`
- first `remainder` peers get `base + 1`, others get `base`
- assign contiguous global index ranges for stable merge order

Store each peer assignment in `datagen:job:{id}:peers` hash.

> Future: add weights or dynamic redistribution by introducing `assignmentVersion` and a “rebalancer”. For now we keep the snapshot assignment stable.

---

## 5) R1FS artifacts (heavy data)

### 5.1 Job details object (one per job)
Stored only after schema is confirmed.

**R1FS CID** stored in `DataGenJobBase.jobDetailsCid`.

Suggested JSON structure (store as a JSON file or YAML; JSON recommended for TS parsing):
```ts
type DataGenJobDetails = {
  id: string;
  owner: string;

  // user-facing
  description: string;
  instructions: string;

  // confirmed schema
  schema: unknown;

  // inference params snapshot
  inference: {
    baseUrl: string;             // local inference base used for schema generation
    path: string;                // /create_chat_completion
    model?: string;
    parameters?: Record<string, unknown>; // temperature, max_tokens, etc.
  };

  datasetMode?: boolean;

  createdAt: string;
  schemaGeneratedAt: string;
  schemaDurationMs: number;
  schemaRefreshes: number;

  // optional: anything else needed later
  meta?: Record<string, unknown>;
};
```

### 5.2 Peer results object (one per peer)
Written to local cache during generation; uploaded to R1FS only at the end.

Recommended file format: **JSONL** (append-only, good for resume):
- one line per generated index:  
  `{"i": 17, "ok": true, "data": {...}}`  
  or  
  `{"i": 17, "ok": false, "error": "..."}"`

At completion, upload the JSONL file as-is to R1FS and store CID in `DataGenJobPeerState.resultCid`.

---

## 6) API changes (refined + minimal disruption)

All routes remain auth-protected fileciteturn1file4.

### 6.1 New: schema draft endpoint
`POST /api/tasks/schema`

Request:
```ts
{
  title: string;
  totalRecords: number;
  description: string;      // human summary used on job card
  instructions: string;     // actual instructions used for schema+records prompts
  datasetMode?: boolean;
  inferenceModel?: string;  // optional
  inferenceParams?: Record<string, unknown>;
  // optional: previousDraftToken to increment schemaRefresh count
  previousDraftToken?: string;
}
```

Behavior:
- Calls local inference API for schema generation (one call)
- Measures schema generation duration
- Returns:
```ts
{
  schema: unknown;
  schemaGeneratedAt: string;
  schemaDurationMs: number;
  schemaRefreshes: number;
  draftToken: string;     // signed, short-lived token carrying all draft inputs+outputs
}
```

**Draft token**
- Contains `{title, totalRecords, description, instructions, schema, schemaGeneratedAt, schemaDurationMs, schemaRefreshes, datasetMode, inferenceModel, inferenceParams}`
- Signed using `DATAGEN_SESSION_SECRET`
- TTL: e.g., 30 minutes
- Purpose: avoids storing drafts in CStore and prevents tampering

### 6.2 New: confirm endpoint
`POST /api/tasks/confirm`

Request:
```ts
{ draftToken: string }
```

Behavior:
1. Verify token signature + TTL.
2. Compute peer assignments from `R1EN_CHAINSTORE_PEERS`.
3. Write to **R1FS**:
   - Upload `DataGenJobDetails` JSON -> `jobDetailsCid`
4. Write to **CStore**:
   - `HSET datagen:jobs {jobId} <DataGenJobBase>`
   - `HSET datagen:job:{jobId}:peers {peerId} <DataGenJobPeerState>` for each peer
   - add to user list: `datagen:user:{username}:jobs`
5. Return `{ jobId }`.

### 6.3 Update existing endpoints to match new storage
- `GET /api/tasks`  
  - Return the current user’s jobs (from `datagen:user:{username}:jobs` + `datagen:jobs`), ordered by `updatedAt`.
- `GET /api/tasks/[id]`  
  - Return `DataGenJobBase` + all peer states + job details fetched from R1FS (schema, instructions, etc.).
- `GET /api/tasks/[id]/export?format=json|csv`
  - Fetch all peer result CIDs from CStore.
  - Download all peer JSONL files from R1FS.
  - Merge into a single ordered array by global index `i` (use stored ranges for sanity).
  - Export JSON or CSV.

---

## 7) Worker loop design (multi-instance)

### 7.1 Startup
Replace the in-process “fire-and-forget runner” fileciteturn1file4 with a singleton polling worker started once per instance:
- `lib/datagen/jobWorker.ts`
- `ensureWorkerStarted()` called from API routes (e.g., `/api/tasks`, `/api/tasks/[id]`) so it starts on first request.

### 7.2 Poll algorithm (every `DATAGEN_JOB_POLL_SECONDS`)
1. Read the jobs index (`datagen:user:{username}:jobs` is user-specific, but worker needs global):
   - Prefer to scan `datagen:jobs` hash entries and pick those where this peer is assigned and not finished.
2. For each job (ordered oldest-first or queued-first):
   - Read this peer’s `DataGenJobPeerState`
   - If `generatedOk + generatedFailed < assigned`, it has work.
   - Ensure the instance isn’t currently busy with another job.
   - Start/resume job generation for this job.

### 7.3 Claiming/locking (minimal, safe)
Because peer assignments are unique, **only the correct peerId should work its slice**.

- Mark `peerState.startedAt` if missing.
- If job base `jobStartedAt` missing, set it (best-effort).
- No global lock is strictly required if peerIds are unique.
- Still: implement “idempotent start” (re-reading state before writes).

### 7.4 Local resume strategy (required)
For each `(jobId, peerId)` maintain:

- `state.json` (small): last known counters + file path
- `results.jsonl` (append-only)

On start/resume:
- If local cache exists:
  - count lines in `results.jsonl` -> `localGenerated`
  - set `startIndex = localGenerated`
  - update CStore progress immediately if CStore is behind
- Continue generation from the next ungenerated index in the assigned range.

### 7.5 Progress updates (spec)
During generation, after each record:
- append to local JSONL
- update in-memory counters
- every `DATAGEN_UPDATE_EVERY_K_REQUESTS`, write peer progress to CStore:
  - update only the peer hash field for this peer

At completion:
- upload `results.jsonl` to R1FS (one file)
- update `peerState.resultCid` in CStore
- update job totals (`totalGenerated/Ok/Failed`) and `updatedAt`
- if all peers have `generatedOk+generatedFailed == assigned` and all have `resultCid`:
  - set job status `succeeded`
  - set `jobFinishedAt`
  - compute `recordsDurationMs` (e.g., `jobFinishedAt - jobStartedAt`)

### 7.6 Updating “only fields” safely
Implement helper methods that only mutate the smallest unit:
- `updatePeerState(jobId, peerId, partial)` reads current peer state JSON, merges, writes back for that peer only.
- `updateJobBase(jobId, partial)` reads base, merges, writes back.
- Avoid rewriting all peers inside the base record to prevent cross-peer write conflicts.

---

## 8) UI changes — job cards

Update `/components/TasksPanel.tsx` fileciteturn1file1 to show **Job Cards**.

### 8.1 Collapsed card fields
- Job title
- Job status
- Progress: `totalGenerated / totalRecords` (only when running/queued)

### 8.2 Expanded card fields
Include everything from collapsed plus:
- Job description (from R1FS details)
- Job instructions (from R1FS details)
- Expandable schema (JSON viewer)
- Number of workers (`peerCount`)
- Date of job start (`jobStartedAt`)
- Date of schema (`schemaGeneratedAt`)
- Date of job end (`jobFinishedAt`)
- Time of generation for schema and records (`schemaDurationMs`, `recordsDurationMs`)
- Schema refreshes (`schemaRefreshes`)
- Per-peer stats table:
  - peerId, assigned, generatedOk, generatedFailed, resultCid (if present), startedAt, finishedAt

Implementation suggestion:
- Use `<details><summary>...</summary>...</details>` for expand/collapse
- Keep schema inside nested `<details>`

---

## 9) Signup flow changes (replace existing /register)

### 9.1 New signup page
Replace `/(auth)/register/page.tsx` (or the current route) with a **Create Account** form that collects:
- name
- email
- country

### 9.2 Password delivery via email
On submit:
- Server generates a strong random password (e.g., 16–24 chars).
- Create user via `@ratio1/cstore-auth-ts` (keep existing integration) fileciteturn1file0
- Send credentials to the provided email.

**Important constraints**
- `cstore-auth-ts` usernames are strict (blog notes strict validation and canonicalization). citeturn23view0
- Email addresses may not be valid usernames.

**Plan**
- Derive `username` from email local-part:
  - lowercase
  - replace invalid chars with `_`
  - append short random suffix to avoid collisions (e.g., `john_smith_4f2a`)
- Store the real `email`, `name`, `country` as user metadata in:
  - cstore-auth user meta (preferred), and/or
  - `datagen:users` index record (`DataGenUserIndex`)

### 9.3 Email implementation
Add SMTP configuration env vars (required in production):
- `DATAGEN_SMTP_HOST`
- `DATAGEN_SMTP_PORT`
- `DATAGEN_SMTP_USER`
- `DATAGEN_SMTP_PASS`
- `DATAGEN_SMTP_FROM`

Implementation:
- Use `nodemailer` in server routes (Node runtime only).
- In local dev, if SMTP not configured:
  - log the credentials to server console (guarded) OR store a one-time “reveal token” visible to admin only.
  - (Pick the least-friction option for your dev workflow.)

---

## 10) Files/modules to update (Codex checklist)

### 10.1 Types + keys
- `lib/datagen/types.ts` — add `DataGenJobBase`, `DataGenJobPeerState`, `DataGenJobDetails`
- `lib/ratio1/keys.ts` — add key builders:
  - `jobsHashKey()` -> `datagen:jobs`
  - `jobPeersHashKey(jobId)` -> `datagen:job:{id}:peers`
  - `userJobsKey(username)` -> `datagen:user:{u}:jobs`
  - `usersIndexKey()` -> `datagen:users`

### 10.2 CStore persistence
- `lib/datagen/taskStore.ts` -> rename/replace with `jobStore.ts`
  - create job base record
  - read job base record
  - update job base record (merge)
  - read/update peer state record for one peer
  - list jobs for user
  - list jobs for peer

### 10.3 Worker implementation
- Replace `lib/datagen/taskRunner.ts` with `lib/datagen/jobWorker.ts`
  - polling loop
  - resume from local cache dir
  - generate per-record inference calls
  - periodic progress updates
  - final upload to R1FS
  - completion detection

### 10.4 API routes
- Add:
  - `/app/api/tasks/schema/route.ts`
  - `/app/api/tasks/confirm/route.ts`
- Update existing:
  - `/app/api/tasks/route.ts` (list jobs only; no more fire-and-forget runner)
  - `/app/api/tasks/[id]/route.ts` (serve full job details)
  - `/app/api/tasks/[id]/export/route.ts` (merge peer result artifacts)

### 10.5 UI
- Update dashboard and TasksPanel to use new schema flow:
  - “Generate schema” -> show schema + confirm/regenerate actions
  - on confirm -> job created and appears in list

### 10.6 Auth: replace register
- Replace `/app/api/auth/register/route.ts` to accept `{name,email,country}` and:
  - generate password
  - create user
  - send email
- Replace `/app/(auth)/register/page.tsx` with create-account form

---

## 11) Export/merge algorithm details (critical)

### 11.1 Merge correctness requirements
- Preserve **global order** of results.
- Support failures (a record may be missing or error entry present).

### 11.2 Recommended merge approach
1. Read all peer states, build list of `(peerId, range, resultCid)`.
2. Download each JSONL from R1FS and parse lines into a map `{i -> record}`.
3. Build final array of length `totalRecords`, for each index i:
   - if entry exists and ok: place `data`
   - if entry exists and error: place a placeholder (or omit in CSV and report errors separately)
   - if missing: treat as error

### 11.3 Streaming note
If jobs can get large, implement streaming export:
- For JSON: write `[` then stream items, then `]`
- For CSV: write header once, stream rows
(This can be added later; initial implementation can load in memory within sensible limits.)

---

## 12) Testing plan (must-have)

### 12.1 Local multi-instance
- Run 2–3 DataGen instances pointed at the same CStore/R1FS endpoints.
- Set `R1EN_CHAINSTORE_PEERS=peerA,peerB,peerC`
- Start each container with its own `R1EN_HOST_ADDR` and its own inference API.

Validate:
- Confirmed job splits evenly.
- Each peer generates only its slice.
- Progress updates show in UI.
- Export merges correctly.

### 12.2 Resume
- Kill one instance mid-job.
- Restart it with same `DATAGEN_LOCAL_CACHE_DIR` volume mounted.
- Verify it continues without duplicating records and updates CStore progress.

### 12.3 CStore update collision safety
- While job runs, have two peers update progress frequently.
- Verify per-peer updates don’t overwrite each other.

---

## 13) Open items / assumptions (explicit)

1. **Exact delimiter** for `R1EN_CHAINSTORE_PEERS` is assumed to be comma-separated.
2. **Peer identity** is provided via `R1EN_HOST_ADDR` (must match peers list).
3. R1FS client supports “add file” and “get file” operations as described in Ratio1 SDK docs/blogs. citeturn23view0turn23view1
4. `@ratio1/cstore-auth-ts` supports programmatic user creation (Codex should adapt by mirroring current `/api/auth/register` implementation and swapping inputs). fileciteturn1file0

---

## 14) Deliverables (definition of done)

- Multi-instance worker loop implemented (polling + per-peer slices)
- Jobs stored in CStore + details/results in R1FS, per spec
- Progress updates happen every `DATAGEN_UPDATE_EVERY_K_REQUESTS` inferences
- Local cache enables resume for interrupted jobs
- UI job cards updated (collapsed + expanded detail requirements)
- Signup form collects name/email/country and emails generated password
- Legacy task endpoints replaced/updated without breaking auth guarantees
